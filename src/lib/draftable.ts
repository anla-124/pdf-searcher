/**
 * Draftable API Client
 * Provides document comparison functionality via self-hosted Draftable instance
 */

import { client } from '@draftable/compare-api'

const accountId = process.env.NEXT_PUBLIC_DRAFTABLE_ACCOUNT_ID
const authToken = process.env.DRAFTABLE_AUTH_TOKEN
const apiUrl = process.env.NEXT_PUBLIC_DRAFTABLE_API_URL || 'https://api.draftable.com/v1'

if (!accountId || !authToken) {
  throw new Error('Draftable credentials not configured. Please set NEXT_PUBLIC_DRAFTABLE_ACCOUNT_ID and DRAFTABLE_AUTH_TOKEN in .env.local')
}

// Initialize Draftable client with custom self-hosted URL
export const draftableClient = client(accountId, authToken, apiUrl)
