/**
 * Tests for Dashboard List Builder
 *
 * Verifies that HA panel data is correctly mapped to dashboard entries
 * for the UI dropdown picker.
 */

import { describe, it, expect } from 'bun:test'
import { buildDashboardList } from '../../ui.js'

describe('buildDashboardList', () => {
  describe('with null/invalid panels', () => {
    it('returns default dashboard when panels is null', () => {
      const result = buildDashboardList(null)

      expect(result).toEqual([
        { path: '/lovelace/0', title: 'Default Dashboard' },
      ])
    })

    it('returns default dashboard when panels is not an object', () => {
      // @ts-expect-error - testing invalid input
      const result = buildDashboardList('not-an-object')

      expect(result).toEqual([
        { path: '/lovelace/0', title: 'Default Dashboard' },
      ])
    })
  })

  describe('with valid panels', () => {
    it('includes only lovelace panels', () => {
      const panels = {
        lovelace: {
          component_name: 'lovelace',
          url_path: 'lovelace',
          title: 'Overview',
          icon: null,
        },
        energy: {
          component_name: 'energy',
          url_path: 'energy',
          title: 'Energy',
          icon: 'mdi:lightning-bolt',
        },
        map: {
          component_name: 'map',
          url_path: 'map',
          title: 'Map',
          icon: 'mdi:map',
        },
      }

      const result = buildDashboardList(panels)

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        path: '/lovelace/0',
        title: 'Default Dashboard',
      })
      expect(result[1]).toEqual({ path: '/lovelace', title: 'Overview' })
    })

    it('maps custom dashboards with correct paths', () => {
      const panels = {
        'my-trmnl': {
          component_name: 'lovelace',
          url_path: 'my-trmnl',
          title: 'TRMNL Display',
          icon: 'mdi:monitor',
        },
        kitchen: {
          component_name: 'lovelace',
          url_path: 'kitchen',
          title: 'Kitchen Panel',
          icon: null,
        },
      }

      const result = buildDashboardList(panels)

      expect(result).toHaveLength(3)
      expect(result[1]).toEqual({
        path: '/my-trmnl',
        title: 'TRMNL Display',
      })
      expect(result[2]).toEqual({
        path: '/kitchen',
        title: 'Kitchen Panel',
      })
    })

    it('uses url_path as title when title is null', () => {
      const panels = {
        untitled: {
          component_name: 'lovelace',
          url_path: 'untitled-dash',
          title: null,
          icon: null,
        },
      }

      const result = buildDashboardList(panels)

      expect(result[1]).toEqual({
        path: '/untitled-dash',
        title: 'untitled-dash',
      })
    })

    it('uses url_path as title when title is empty string', () => {
      const panels = {
        empty: {
          component_name: 'lovelace',
          url_path: 'empty-title',
          title: '',
          icon: null,
        },
      }

      const result = buildDashboardList(panels)

      expect(result[1]!.title).toBe('empty-title')
    })
  })

  describe('deduplication', () => {
    it('does not duplicate default dashboard path', () => {
      const panels = {
        lovelace: {
          component_name: 'lovelace',
          url_path: 'lovelace/0',
          title: 'Overview',
          icon: null,
        },
      }

      const result = buildDashboardList(panels)

      const lovelacePaths = result.filter((d) => d.path === '/lovelace/0')
      expect(lovelacePaths).toHaveLength(1)
    })

    it('keeps first occurrence when panels have duplicate url_paths', () => {
      const panels = {
        home: {
          component_name: 'lovelace',
          url_path: 'home',
          title: 'Home',
          icon: null,
        },
        'home-alias': {
          component_name: 'lovelace',
          url_path: 'home',
          title: 'Home Alias',
          icon: null,
        },
      }

      const result = buildDashboardList(panels)

      const homePaths = result.filter((d) => d.path === '/home')
      expect(homePaths).toHaveLength(1)
      expect(homePaths[0]!.title).toBe('Home')
    })
  })

  describe('with empty panels object', () => {
    it('returns only default dashboard', () => {
      const result = buildDashboardList({})

      expect(result).toEqual([
        { path: '/lovelace/0', title: 'Default Dashboard' },
      ])
    })
  })
})
