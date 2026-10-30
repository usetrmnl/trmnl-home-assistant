import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { planRefresh, validateRefreshConfigs, type RefreshConfig, type RefreshState, type DeviceTiming } from '../../lib/scheduler/refresh-planner.js'
import { RefreshWorker, timingFromAccount, type RefreshDeps } from '../../lib/scheduler/refresh-worker.js'
import type { Schedule } from '../../types/domain.js'

process.env.TZ = 'America/New_York'
const config: RefreshConfig = { schedule_id: 'test', device_id: 1, lead_seconds: 180, fallback_interval_seconds: 1800, initial_intervals_seconds: [1800, 3600] }
const at = (time: string) => new Date(`2026-10-27T${time}-04:00`)
const device: DeviceTiming = { refresh_interval: 1800, hardware_last_ping_at: at('12:00:00').toISOString(), sleep_mode_enabled: true, sleep_start_time: 1380, sleep_end_time: 420 }
const saved: RefreshState = { ping: at('12:00:00').getTime()/1000, latched_interval: 1800, configured_interval: 1800 }
const run = (time: string, d: DeviceTiming | null = device, s: RefreshState = saved) => planRefresh(at(time), d, s, config)

describe('refresh planner', () => {
  test('account readback allowlists fields and rejects incomplete sleep settings', () => {
    const data = { ...device, id:1, private_account_field:'PRIVATE_ACCOUNT' }
    expect(JSON.stringify(timingFromAccount({data},1))).not.toContain('PRIVATE_ACCOUNT')
    expect(() => timingFromAccount({data},2)).toThrow('Account read failed')
    expect(() => timingFromAccount({data:{...data,sleep_end_time:undefined}},1)).toThrow('Account read failed')
  })
  test('bounded lead, deduplication and no synthetic anchor', () => {
    expect(run('12:26:59').plan.due).toBe(false)
    const due = run('12:27:00')
    expect(due.plan.due).toBe(true)
    expect(run('12:28:00', device, { ...due.state, delivered: [due.plan.key] }).plan.due).toBe(false)
    expect(run('13:05:00').state.ping).toBe(saved.ping)
    expect(run('13:05:00').plan.reason).toBe('stale_fallback')
  })
  test('rate changes retain pending old rate until a real new ping', () => {
    const changed = run('12:27:00', { ...device, refresh_interval: 3600 })
    expect(changed.plan.candidate_intervals).toEqual([1800,3600])
    expect(changed.plan.due).toBe(true)
    const next = run('12:31:00', { ...device, refresh_interval:3600, hardware_last_ping_at:at('12:30:00').toISOString() }, changed.state)
    expect(next.plan.candidate_intervals).toEqual([3600])
  })
  test('fresh install uncertainty and invalid/regressed/future pings', () => {
    expect(run('12:05:00', device, {}).plan.candidate_intervals).toEqual([1800,3600])
    for (const ping of ['bad', at('12:00:00').toISOString(), at('14:00:00').toISOString()]) {
      const prior = { ...saved, ping:at('12:01:00').getTime()/1000 }
      expect(run('12:05:00', {...device, hardware_last_ping_at:ping}, prior).state.ping).toBe(prior.ping)
    }
  })
  test('sleep, wake, one-time sleep, floors and retries', () => {
    expect(run('23:30:00').plan.due).toBe(false)
    expect(run('06:57:00').plan.reason).toBe('wake')
    expect(run('06:57:00').plan.due).toBe(true)
    expect(run('06:57:00', {...device, sleep_until:at('09:00:00').toISOString()}).plan.due).toBe(false)
    expect(run('12:27:00',device,{...saved,last_success:at('12:26:00').getTime()/1000}).plan.due).toBe(false)
    expect(run('12:27:00',device,{...saved,retry_after:at('12:28:00').getTime()/1000}).plan.due).toBe(false)
  })
  test('daytime sleep and DST wake use calendar time', () => {
    expect(run('12:27:00', {...device,sleep_start_time:600,sleep_end_time:900}).plan.due).toBe(false)
    const dst = planRefresh(new Date('2026-11-01T06:57:00-05:00'), device, saved,config)
    expect(new Date(dst.plan.target*1000).getHours()).toBe(7)
    expect(dst.plan.due).toBe(true)
  })
  test('configuration validation does not echo secrets', () => {
    validateRefreshConfigs([config])
    for (const invalid of [{...config, lead_seconds:0},{...config,device_id:-1},{...config,initial_intervals_seconds:[NaN]}]) {
      expect(() => validateRefreshConfigs([invalid])).toThrow('Invalid refresh scheduling configuration')
    }
    expect(() => validateRefreshConfigs([config,config])).toThrow()
  })
})

describe('persistent runtime', () => {
  async function harness(body:(h:{worker:RefreshWorker; deps:RefreshDeps; file:string; sends:()=>number; setTime:(s:string)=>void})=>Promise<void>) {
    const dir = await mkdtemp(path.join(tmpdir(),'refresh-test-')), file=path.join(dir,'state.json')
    let sends=0, now=at('12:27:00')
    const deps:RefreshDeps = {
      now:()=>now, readDevice:async()=>device,
      loadSchedules:async()=>[{id:'test',enabled:true,interval_minutes:null,webhook_url:'PRIVATE_WEBHOOK'} as Schedule],
      execute:async()=>{sends++;return {success:true,savedPath:'x',webhook:{attempted:true,success:true}}},
    }
    const worker=new RefreshWorker([config],file,deps)
    try { await body({worker,deps,file,sends:()=>sends,setTime:s=>{now=at(s)}}) } finally {await rm(dir,{recursive:true,force:true})}
  }
  test('initial account outage fails closed until timing is available',async()=>harness(async h=>{
    h.deps.readDevice=async()=>{throw new Error('private')}
    await h.worker.tick();expect(h.sends()).toBe(0)
    h.deps.readDevice=async()=>device
    await h.worker.tick();expect(h.sends()).toBe(1)
  }))
  test('fixed retry survives restart and overlapping poll is queued',async()=>harness(async h=>{
    h.setTime('00:00:00')
    let tries=0
    h.deps.execute=async()=>{tries++;return {success:true,savedPath:'x',webhook:{attempted:true,success:tries>1}}}
    await Promise.all([h.worker.tick(),h.worker.tick('test')]);expect(tries).toBe(1)
    h.setTime('00:02:01')
    const restarted=new RefreshWorker([config],h.file,h.deps)
    await restarted.tick();expect(tries).toBe(2)
    await restarted.tick();expect(tries).toBe(2)
  }))
  test('autonomous upload, persisted restart dedup and reanchor', async()=>harness(async h=>{
    await h.worker.tick();expect(h.sends()).toBe(1)
    const restarted=new RefreshWorker([config],h.file,h.deps)
    await restarted.tick();expect(h.sends()).toBe(1)
    h.setTime('12:31:00');h.deps.readDevice=async()=>({...device,hardware_last_ping_at:at('12:30:00').toISOString()})
    await restarted.tick()
    expect(JSON.stringify(restarted.status())).toContain(String(at('12:30:00').getTime()/1000))
    expect(JSON.stringify(restarted.status())).not.toContain('PRIVATE_WEBHOOK')
    expect(await readFile(h.file,'utf8')).not.toContain('PRIVATE_WEBHOOK')
  }))
  test('failed delivery backs off and retries; busy ticks do not overlap',async()=>harness(async h=>{
    let tries=0
    h.deps.execute=async()=>{tries++;await new Promise(r=>setTimeout(r,5));return {success:true,savedPath:'x',webhook:{attempted:true,success:tries>1}}}
    await Promise.all([h.worker.tick(),h.worker.tick()]);expect(tries).toBe(1)
    await h.worker.tick();expect(tries).toBe(1)
    h.setTime('12:29:01');await h.worker.tick();expect(tries).toBe(2)
  }))
  test('disabled/competing interval refuses to send; corrupt storage fails closed',async()=>harness(async h=>{
    h.deps.loadSchedules=async()=>[{id:'test',enabled:true,interval_minutes:30,webhook_url:'secret'} as Schedule]
    await h.worker.tick();expect(h.sends()).toBe(0)
    await writeFile(h.file,'bad')
    const restarted=new RefreshWorker([config],h.file,h.deps)
    await restarted.tick('test');expect(JSON.stringify(restarted.status())).toContain('unavailable')
  }))
  test('fixed captures run during sleep, share reservations and survive account failure',async()=>harness(async h=>{
    h.setTime('00:00:00');await h.worker.tick('test');expect(h.sends()).toBe(1)
    await h.worker.tick('test');expect(h.sends()).toBe(1)
    h.deps.readDevice=async()=>{throw new Error('PRIVATE_ACCOUNT_TOKEN')}
    h.setTime('00:10:00');await h.worker.tick();expect(h.sends()).toBe(1)
    expect(JSON.stringify(h.worker.status())).not.toContain('PRIVATE_ACCOUNT_TOKEN')
  }))
})
