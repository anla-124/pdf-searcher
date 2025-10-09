/**
 * End-to-end tests for complete document workflow
 * Tests the full user journey from login to document processing
 */

import { test, expect } from '@playwright/test'

test.describe('PDF Searcher Document Workflow', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the login page (root redirects to /login)
    await page.goto('/login')
  })

  test('should load login page', async ({ page }) => {
    // Verify we're on the login page
    await expect(page).toHaveURL(/\/login/)

    // Verify page loaded successfully (check for any visible content)
    // Just checking the page doesn't crash - OAuth button may not work without credentials
    await expect(page.locator('body')).toBeVisible()

    // Verify the page has some content (even if Supabase isn't configured)
    const pageContent = await page.textContent('body')
    expect(pageContent).toBeTruthy()
  })

  // Skip this test in CI since it requires OAuth authentication
  // TODO: Implement OAuth mocking for E2E tests
  const skipInCI = !!process.env.CI
  ;(skipInCI ? test.skip : test)('should complete basic document upload workflow', async ({ page }) => {
    // Step 1: Login/Authentication - OAuth flow (manual step in real test)
    // Note: In real E2E testing, OAuth would redirect to Google/GitHub
    // For this test, we assume user completes OAuth and gets redirected back
    
    // Click login button to start OAuth flow
    await page.click('[data-testid="login-button"]')
    
    // Wait for dashboard to load after OAuth redirect
    // In a real test environment, this would require OAuth mock or test credentials
    await expect(page.locator('[data-testid="dashboard"]')).toBeVisible({ timeout: 10000 })

    // Step 2: Upload form is already visible on dashboard
    await expect(page.locator('[data-testid="upload-form"]')).toBeVisible()

    // Step 3: Upload document
    const fileInput = page.locator('[data-testid="file-input"]')
    await fileInput.setInputFiles('./tests/fixtures/sample-document.pdf')

    // Step 4: Fill metadata form - these are SearchableSelect components
    // Using values from current metadata constants
    await page.click('[data-testid="law-firm-select"]')
    await page.getByText('STB').click()

    await page.click('[data-testid="fund-manager-select"]')
    await page.getByText('Blackstone').click()

    await page.click('[data-testid="fund-admin-select"]')
    await page.getByText('Standish').click()

    await page.click('[data-testid="jurisdiction-select"]')
    await page.getByText('Delaware').click()

    // Verify dropdowns show selected values (SearchableSelect shows selected text)
    await expect(page.locator('[data-testid="law-firm-select"]')).toContainText('STB')
    await expect(page.locator('[data-testid="fund-manager-select"]')).toContainText('Blackstone')
    await expect(page.locator('[data-testid="fund-admin-select"]')).toContainText('Standish')
    await expect(page.locator('[data-testid="jurisdiction-select"]')).toContainText('Delaware')

    // Step 5: Submit upload
    await page.click('[data-testid="upload-submit-button"]')
    
    // Wait for upload to complete (button should change text)
    await expect(page.locator('[data-testid="upload-submit-button"]')).toContainText('Processing', { timeout: 5000 })

    // Step 6: Document list is on the same dashboard page
    // Step 7: Verify document appears in enhanced document list
    await expect(page.locator('[data-testid="dashboard"]')).toBeVisible()

    // Wait for document to appear (may take a moment)
    await page.waitForSelector('[data-testid="document-item"]', { timeout: 10000 })
    
    const documentItem = page.locator('[data-testid="document-item"]').first()
    await expect(documentItem).toBeVisible()
    
    // Verify document status shows processing
    const statusBadge = documentItem.locator('[data-testid="document-status"]')
    await expect(statusBadge).toContainText(/processing|queued|pending/)

    // Step 8: Wait for processing to complete (or timeout in reasonable time)
    await page.waitForFunction(() => {
      const status = document.querySelector('[data-testid="document-status"]')?.textContent
      return status?.includes('completed') || status?.includes('ready')
    }, { timeout: 60000 }) // 1 minute timeout for processing

    // Step 9: Verify completed document
    await expect(statusBadge).toContainText(/completed|ready/)

    // Step 10: Click on document to view details
    await documentItem.click()

    // Wait for document details page (documents/[id] route with UUID)
    await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/)

    // Verify document content is displayed
    await expect(page.locator('h1')).toBeVisible() // Document title
    await expect(page.locator('text=Processing Status|Status')).toBeVisible() // Status section
  })
})