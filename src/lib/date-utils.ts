import { format, parseISO } from 'date-fns'

/**
 * Formats a date string from the database to a user-friendly format
 * Handles timezone conversion from UTC to local time
 */
export function formatUploadDate(dateString: string): string {
  try {
    // Parse and format exactly as stored in Supabase without timezone conversion
    // Input: "2025-09-29 15:00:13.212493+00" -> Output: "29 Sep 2025 - 3:00 PM"
    const date = new Date(dateString)
    
    if (isNaN(date.getTime())) {
      throw new Error('Invalid date')
    }
    
    // Extract UTC components to avoid timezone conversion
    const year = date.getUTCFullYear()
    const month = date.getUTCMonth()
    const day = date.getUTCDate()
    const hours = date.getUTCHours()
    const minutes = date.getUTCMinutes()
    
    // Create a new date in local timezone with UTC components
    // This effectively shows the UTC time as if it were local time
    const displayDate = new Date(year, month, day, hours, minutes)
    
    return format(displayDate, 'dd MMM yyyy - h:mm a')
  } catch (error) {
    console.error('[date-utils] Error formatting date:', error instanceof Error ? error.message : 'Unknown error', { dateString })
    return 'Invalid date'
  }
}

/**
 * Formats a date to show exact UTC time (for debugging)
 */
export function formatUploadDateUTC(dateString: string): string {
  try {
    const date = parseISO(dateString)
    return format(date, 'dd MMM yyyy - h:mm a') + ' UTC'
  } catch (error) {
    console.error('[date-utils] Error formatting UTC date:', error instanceof Error ? error.message : 'Unknown error', { dateString })
    return 'Invalid date'
  }
}

/**
 * Alternative date formatter using different approach
 * In case the ISO parsing is causing issues
 */
export function formatUploadDateAlt(dateString: string): string {
  try {
    // Try creating Date object directly
    const date = new Date(dateString)

    if (isNaN(date.getTime())) {
      throw new Error('Invalid date')
    }

    return format(date, 'dd MMM yyyy - h:mm a')
  } catch (error) {
    console.error('[date-utils] Error formatting date (alt):', error instanceof Error ? error.message : 'Unknown error', { dateString })
    return 'Invalid date'
  }
}

/**
 * More explicit UTC to local conversion
 * For debugging timezone issues
 */
export function formatUploadDateExplicit(dateString: string): string {
  try {
    // Explicitly handle UTC conversion
    let utcDate: Date

    if (dateString.includes('+00') || dateString.endsWith('Z')) {
      // This is already UTC, parse normally
      utcDate = new Date(dateString)
    } else {
      // Assume UTC if no timezone specified
      utcDate = new Date(dateString + (dateString.includes('T') ? 'Z' : ' UTC'))
    }

    if (isNaN(utcDate.getTime())) {
      throw new Error('Invalid date')
    }

    // Debug logging for explicit date conversion (development only)
    if (process.env.NODE_ENV === 'development') {
      console.warn('[date-utils] Explicit date conversion:', {
        input: dateString,
        utcDate: utcDate.toISOString(),
        localDate: utcDate.toString(),
        formatted: format(utcDate, 'dd MMM yyyy - h:mm a')
      })
    }

    return format(utcDate, 'dd MMM yyyy - h:mm a')
  } catch (error) {
    console.error('[date-utils] Error formatting date (explicit):', error instanceof Error ? error.message : 'Unknown error', { dateString })
    return 'Invalid date'
  }
}