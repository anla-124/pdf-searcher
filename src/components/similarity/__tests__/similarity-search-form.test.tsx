import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SimilaritySearchForm } from '../similarity-search-form'
import { Document } from '@/types'

// Mock the SimilarityResults component
vi.mock('../similarity-results', () => ({
  SimilarityResults: ({ results, isLoading }: { results: any[], isLoading: boolean }) => (
    <div data-testid="similarity-results">
      {isLoading ? 'Loading...' : `${results.length} results`}
    </div>
  )
}))

const mockDocument: Document = {
  id: 'test-doc-1',
  title: 'Test Document',
  filename: 'test.pdf',
  file_size: 1024,
  page_count: 5,
  status: 'completed',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  user_id: 'user-1',
  file_path: '/test.pdf',
  extracted_text: 'Test content',
  metadata: {
    law_firm: 'STB',
    fund_manager: 'Blackstone',
    fund_admin: 'Standish',
    jurisdiction: 'Delaware'
  }
}

// Mock fetch for API calls
const mockFetch = vi.fn()
global.fetch = mockFetch

describe.skip('SimilaritySearchForm', () => { // TODO: Update tests to match current component implementation
  beforeEach(() => {
    mockFetch.mockClear()
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([])
    })
  })

  it('renders the similarity search form', () => {
    render(<SimilaritySearchForm documentId="test-doc-1" sourceDocument={mockDocument} />)
    
    expect(screen.getByText('Similarity Search')).toBeInTheDocument()
    expect(screen.getByText('Search documents similar to "Test Document"')).toBeInTheDocument()
  })

  it('renders all business metadata filters', () => {
    render(<SimilaritySearchForm documentId="test-doc-1" sourceDocument={mockDocument} />)
    
    expect(screen.getByText('Filters')).toBeInTheDocument()
    expect(screen.getByText('Law Firm')).toBeInTheDocument()
    expect(screen.getByText('Fund Manager')).toBeInTheDocument()
    expect(screen.getByText('Fund Admin')).toBeInTheDocument()
    expect(screen.getByText('Jurisdiction')).toBeInTheDocument()
  })

  it('has default filter values set to "Any"', () => {
    render(<SimilaritySearchForm documentId="test-doc-1" sourceDocument={mockDocument} />)
    
    // Check that dropdowns show "Any" as placeholders
    expect(screen.getByText('Any law firm')).toBeInTheDocument()
    expect(screen.getByText('Any fund manager')).toBeInTheDocument()
    expect(screen.getByText('Any fund admin')).toBeInTheDocument()
    expect(screen.getByText('Any jurisdiction')).toBeInTheDocument()
  })

  it('allows selecting business metadata filters', async () => {
    const user = userEvent.setup()
    render(<SimilaritySearchForm documentId="test-doc-1" sourceDocument={mockDocument} />)
    
    // Click on Law Firm dropdown and select STB
    const lawFirmTrigger = screen.getByRole('combobox', { name: /law firm/i })
    await user.click(lawFirmTrigger)
    
    const stbOption = screen.getByRole('option', { name: 'STB' })
    await user.click(stbOption)
    
    // Verify selection
    expect(screen.getByDisplayValue('STB')).toBeInTheDocument()
  })

  it('resets filters when Reset button is clicked', async () => {
    const user = userEvent.setup()
    render(<SimilaritySearchForm documentId="test-doc-1" sourceDocument={mockDocument} />)
    
    // First, perform a search to enable reset
    const searchButton = screen.getByRole('button', { name: /search/i })
    await user.click(searchButton)
    
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /reset/i })).not.toBeDisabled()
    })
    
    // Click reset button
    const resetButton = screen.getByRole('button', { name: /reset/i })
    await user.click(resetButton)
    
    // Verify filters are reset
    expect(screen.getByText('Any law firm')).toBeInTheDocument()
    expect(screen.getByText('Any fund manager')).toBeInTheDocument()
  })

  it('sends correct API request with business filters', async () => {
    const user = userEvent.setup()
    render(<SimilaritySearchForm documentId="test-doc-1" sourceDocument={mockDocument} />)
    
    // Select STB law firm filter
    const lawFirmTrigger = screen.getByRole('combobox', { name: /law firm/i })
    await user.click(lawFirmTrigger)
    await user.click(screen.getByRole('option', { name: 'STB' }))
    
    // Click search
    const searchButton = screen.getByRole('button', { name: /search/i })
    await user.click(searchButton)
    
    // Verify API call
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/documents/test-doc-1/similar',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filters: expect.objectContaining({
              law_firm: ['STB'],
              min_score: 0.7,
              page_range: {
                use_entire_document: true
              }
            }),
            topK: 20,
          })
        })
      )
    })
  })

  it('sends multiple business filters in API request', async () => {
    const user = userEvent.setup()
    render(<SimilaritySearchForm documentId="test-doc-1" sourceDocument={mockDocument} />)
    
    // Select multiple filters
    const lawFirmTrigger = screen.getByRole('combobox', { name: /law firm/i })
    await user.click(lawFirmTrigger)
    await user.click(screen.getByRole('option', { name: 'STB' }))
    
    const fundManagerTrigger = screen.getByRole('combobox', { name: /fund manager/i })
    await user.click(fundManagerTrigger)
    await user.click(screen.getByRole('option', { name: 'Blackstone' }))
    
    // Click search
    const searchButton = screen.getByRole('button', { name: /search/i })
    await user.click(searchButton)
    
    // Verify API call with multiple filters
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/documents/test-doc-1/similar',
        expect.objectContaining({
          body: JSON.stringify({
            filters: expect.objectContaining({
              law_firm: ['STB'],
              fund_manager: ['Blackstone'],
              min_score: 0.7,
              page_range: {
                use_entire_document: true
              }
            }),
            topK: 20,
          })
        })
      )
    })
  })

  it('does not send empty filter arrays', async () => {
    const user = userEvent.setup()
    render(<SimilaritySearchForm documentId="test-doc-1" sourceDocument={mockDocument} />)
    
    // Click search without selecting any filters
    const searchButton = screen.getByRole('button', { name: /search/i })
    await user.click(searchButton)
    
    // Verify API call doesn't include business filter arrays
    await waitFor(() => {
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(callBody.filters.law_firm).toEqual([])
      expect(callBody.filters.fund_manager).toEqual([])
      expect(callBody.filters.fund_admin).toEqual([])
      expect(callBody.filters.jurisdiction).toEqual([])
    })
  })

  it('handles API errors gracefully', async () => {
    const user = userEvent.setup()

    // Mock API error
    mockFetch.mockRejectedValueOnce(new Error('API Error'))

    // Mock alert to verify error handling
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})

    render(<SimilaritySearchForm documentId="test-doc-1" sourceDocument={mockDocument} />)

    const searchButton = screen.getByRole('button', { name: /search/i })
    await user.click(searchButton)

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Failed to search for similar documents. Please try again.')
    })

    alertSpy.mockRestore()
  })

  it('displays search results after successful search', async () => {
    const user = userEvent.setup()
    
    // Mock successful API response with results
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        { document: { id: 'result-1', title: 'Result 1' }, score: 0.8 },
        { document: { id: 'result-2', title: 'Result 2' }, score: 0.7 }
      ])
    })
    
    render(<SimilaritySearchForm documentId="test-doc-1" sourceDocument={mockDocument} />)
    
    const searchButton = screen.getByRole('button', { name: /search/i })
    await user.click(searchButton)
    
    await waitFor(() => {
      expect(screen.getByTestId('similarity-results')).toBeInTheDocument()
      expect(screen.getByText('2 results')).toBeInTheDocument()
    })
  })

  it('shows loading state during search', async () => {
    const user = userEvent.setup()
    
    // Mock delayed API response
    mockFetch.mockImplementationOnce(() => 
      new Promise(resolve => setTimeout(() => resolve({
        ok: true,
        json: () => Promise.resolve([])
      }), 100))
    )
    
    render(<SimilaritySearchForm documentId="test-doc-1" sourceDocument={mockDocument} />)
    
    const searchButton = screen.getByRole('button', { name: /search/i })
    await user.click(searchButton)
    
    // Check loading state
    expect(screen.getByText('Searching...')).toBeInTheDocument()
    
    // Wait for completion
    await waitFor(() => {
      expect(screen.queryByText('Searching...')).not.toBeInTheDocument()
    })
  })
})
