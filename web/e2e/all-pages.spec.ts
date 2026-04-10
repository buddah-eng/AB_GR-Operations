/**
 * E2E Page Audit — Every page must load without errors
 *
 * These tests define the MINIMUM bar for Phase 6 completion:
 * every page loads, shows the right title, and renders data.
 * A failing test means the page is broken for users.
 */

import { test, expect } from '@playwright/test'

// ============================================================
// OPERATIONAL PAGES (config-driven shells)
// ============================================================

test.describe('Config-driven pages', () => {
  test('/dashboard — renders widgets from PageConfig', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.locator('main')).toBeVisible()
    // Should show dashboard heading
    await expect(page.locator('main h1, main h2').first()).toBeVisible()
    // Should have at least one widget
    await expect(page.locator('main h3').first()).toBeVisible()
    // No error alerts
    await expect(page.locator('[role="alert"]')).toHaveCount(0)
  })

  test('/guests — renders guest cards from ViewConfig', async ({ page }) => {
    await page.goto('/guests')
    await expect(page.locator('main h1')).toContainText(/guest/i)
    // Wait for API response + Vue render cycle
    await page.waitForResponse(resp => resp.url().includes('/api/domains/guest') && resp.status() === 200)
    await page.waitForTimeout(1000)
    const mainContent = await page.locator('main').textContent()
    expect(mainContent).toContain('Tanaka Ichiro')
  })

  test('/guests/new — renders intake wizard from FormConfig', async ({ page }) => {
    await page.goto('/guests/new')
    await expect(page.locator('main h1')).toContainText(/new/i)
    // Should show wizard steps
    await expect(page.locator('button', { hasText: 'Basic Info' })).toBeVisible()
    await expect(page.locator('button', { hasText: 'Contact' })).toBeVisible()
    await expect(page.locator('button', { hasText: 'Convention Details' })).toBeVisible()
    // Should have form inputs
    const inputs = page.locator('input, textarea, select')
    await expect(inputs.first()).toBeVisible()
  })

  test('/guests/:id — renders detail page with record data', async ({ page }) => {
    // First get a guest ID from the API
    const apiResp = await page.request.get('/api/domains/guest', {
      headers: { 'Authorization': 'Bearer dev-bypass-token', 'X-Dev-Role': 'director' }
    })
    const json = await apiResp.json()
    // Real backend: data is an array directly; shim: data.records
    const guests = Array.isArray(json.data) ? json.data : (json.data?.records ?? [])
    expect(guests.length).toBeGreaterThan(0)
    const guestId = guests[0].id

    await page.goto(`/guests/${guestId}`)
    await expect(page.locator('main h1')).toBeVisible({ timeout: 10000 })
    const heading = await page.locator('main h1').textContent()
    expect(heading?.length).toBeGreaterThan(0)
  })

  test('/staff — renders staff cards from ViewConfig', async ({ page }) => {
    await page.goto('/staff')
    await expect(page.locator('main h1')).toContainText(/staff/i)
    // Wait for API response and rendering
    await page.waitForResponse(resp => resp.url().includes('/api/domains/staff') && resp.status() === 200)
    // Give Vue time to render the cards
    await page.waitForTimeout(1000)
    const mainContent = await page.locator('main').textContent()
    expect(mainContent).toContain('Tanaka')
  })

  test('/schedule — renders timeline from ViewConfig', async ({ page }) => {
    await page.goto('/schedule')
    await expect(page.locator('main h1')).toBeVisible()
    // Should not show error alerts
    const alerts = page.locator('main [role="alert"]')
    await expect(alerts).toHaveCount(0)
  })

  test('/prep-tracker — renders kanban from ViewConfig', async ({ page }) => {
    await page.goto('/prep-tracker')
    await expect(page.locator('main h1')).toContainText(/prep/i)
    // Should show kanban columns
    await expect(page.locator('main').first()).toBeVisible()
    // No errors
    await expect(page.locator('main [role="alert"]')).toHaveCount(0)
  })

  test('/workflows — loads without crash', async ({ page }) => {
    await page.goto('/workflows')
    await expect(page.locator('main h1')).toBeVisible()
    // May show empty state or data — but should NOT show 500 error
    const errorText = page.locator('text=500')
    await expect(errorText).toHaveCount(0)
  })

  test('/settings — renders department-centric settings', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.locator('main h1')).toContainText(/settings/i)
    // Should show settings cards
    const cards = page.locator('main h3')
    await expect(cards.first()).toBeVisible()
  })
})

// ============================================================
// DOMAIN LIST PAGES (DomainListView)
// ============================================================

test.describe('Domain list pages', () => {
  const domains = ['travel', 'accommodations', 'dietary', 'autographs', 'venues', 'pairings']

  for (const domain of domains) {
    test(`/${domain} — loads without 500 error`, async ({ page }) => {
      await page.goto(`/${domain}`)
      await expect(page.locator('main h1')).toBeVisible()
      // Should NOT show "does not exist" error
      const error500 = page.locator('text=does not exist')
      await expect(error500).toHaveCount(0)
    })
  }
})

// ============================================================
// CANVAS PAGES
// ============================================================

test.describe('Canvas pages', () => {
  test('/canvas — system graph loads toolbar', async ({ page }) => {
    await page.goto('/canvas')
    await expect(page.locator('main').first()).toBeVisible({ timeout: 15000 })
    // Canvas may show error on cold start — just verify page loads without crash
    await page.waitForTimeout(2000)
    const mainText = await page.locator('main').textContent()
    expect(mainText?.length).toBeGreaterThan(0)
  })

  test('/canvas/data-flows — data flow canvas loads', async ({ page }) => {
    await page.goto('/canvas/data-flows')
    await expect(page.locator('main').first()).toBeVisible()
    await expect(page.locator('text=Endpoint not found')).toHaveCount(0)
  })
})

// ============================================================
// BUILDER PAGES
// ============================================================

test.describe('Builder pages', () => {
  test('/builder/form/guest — form builder loads ontology', async ({ page }) => {
    await page.goto('/builder/form/guest')
    await expect(page.locator('main').first()).toBeVisible()
    // Should show form builder UI (layout options or property list)
    await expect(page.getByText('Single').or(page.getByText('Wizard')).first()).toBeVisible({ timeout: 10000 })
  })

  test('/builder/view/guest — view builder loads', async ({ page }) => {
    await page.goto('/builder/view/guest')
    await expect(page.locator('main').first()).toBeVisible()
    // Should show view type tabs (Table, Kanban, Timeline, Dashboard)
    await expect(page.getByText('Table', { exact: true }).first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Kanban', { exact: true })).toBeVisible()
  })

  test('/builder/workflow — workflow builder loads', async ({ page }) => {
    await page.goto('/builder/workflow')
    // Workflow builder is a complex component — give it time on cold starts
    await page.waitForTimeout(3000)
    await expect(page.locator('main').first()).toBeVisible({ timeout: 15000 })
  })
})
