/**
 * Quick verification script for centroids
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

async function verify() {
  const { data, error } = await supabase
    .from('documents')
    .select('id, title, effective_chunk_count, embedding_model')
    .not('centroid_embedding', 'is', null)
    .limit(5)

  if (error) {
    console.error('Error:', error)
    return
  }

  console.log('\n✅ Sample of documents with centroids:\n')
  console.table(data)

  console.log(`\n📊 Total documents with centroids: ${data.length}`)
}

verify().then(() => process.exit(0))
