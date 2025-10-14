#!/usr/bin/env node

/**
 * Test the bidirectional matching logic to verify 1-to-1 constraint
 */

// Simulate the fixed mergeBidirectionalMatches function
function mergeBidirectionalMatches(matchesAtoB, matchesBtoA) {
  // Collect all candidate pairs
  const allPairs = []

  // Add matches from A→B
  for (const match of matchesAtoB.values()) {
    allPairs.push(match)
  }

  // Add matches from B→A (swapped to ensure chunkA is from doc A)
  for (const match of matchesBtoA.values()) {
    const swapped = {
      chunkA: match.chunkB,  // Swap
      chunkB: match.chunkA,  // Swap
      score: match.score
    }
    allPairs.push(swapped)
  }

  // Sort by score (highest first) for greedy selection
  allPairs.sort((a, b) => b.score - a.score)

  // Greedy 1-to-1 matching: select highest-score pairs without reusing chunks
  const usedChunkA = new Set()
  const usedChunkB = new Set()
  const result = []

  for (const pair of allPairs) {
    // Skip if either chunk already used
    if (usedChunkA.has(pair.chunkA.id) || usedChunkB.has(pair.chunkB.id)) {
      continue
    }

    // Accept this pair
    result.push(pair)
    usedChunkA.add(pair.chunkA.id)
    usedChunkB.add(pair.chunkB.id)
  }

  return result
}

// Test case: 90 source chunks, 180 candidate chunks
console.log('🧪 Testing Bidirectional Matching with 1-to-1 Constraint\n')
console.log('Scenario: 90 source chunks vs 180 candidate chunks')
console.log('Expected: Max 90 pairs (each source chunk matched at most once)\n')

// Simulate A→B matches (each A chunk finds best B chunk)
const matchesAtoB = new Map()
for (let i = 0; i < 90; i++) {
  matchesAtoB.set(`A_${i}`, {
    chunkA: { id: `A_${i}` },
    chunkB: { id: `B_${i}` },  // A_i → B_i
    score: 0.95
  })
}
console.log(`A→B matches: ${matchesAtoB.size} pairs`)

// Simulate B→A matches (each B chunk finds best A chunk)
const matchesBtoA = new Map()
for (let i = 0; i < 180; i++) {
  const bestA = i % 90  // B chunks 0-89 match A_0-89, B chunks 90-179 also match A_0-89
  matchesBtoA.set(`B_${i}`, {
    chunkA: { id: `B_${i}` },
    chunkB: { id: `A_${bestA}` },  // B_i → A_{i%90}
    score: 0.93
  })
}
console.log(`B→A matches: ${matchesBtoA.size} pairs`)

// Merge with 1-to-1 constraint
const result = mergeBidirectionalMatches(matchesAtoB, matchesBtoA)

console.log(`\nAfter 1-to-1 constraint: ${result.length} pairs\n`)

// Verify no duplicates
const usedA = new Set()
const usedB = new Set()
let duplicateA = 0
let duplicateB = 0

for (const pair of result) {
  if (usedA.has(pair.chunkA.id)) duplicateA++
  if (usedB.has(pair.chunkB.id)) duplicateB++
  usedA.add(pair.chunkA.id)
  usedB.add(pair.chunkB.id)
}

console.log(`Verification:`)
console.log(`  Unique source chunks used: ${usedA.size}`)
console.log(`  Unique candidate chunks used: ${usedB.size}`)
console.log(`  Duplicate source chunks: ${duplicateA}`)
console.log(`  Duplicate candidate chunks: ${duplicateB}`)

if (result.length === 90 && duplicateA === 0 && duplicateB === 0) {
  console.log(`\n✅ PASSED: 1-to-1 constraint working correctly!`)

  // Calculate expected scores
  const docA = 90
  const docB = 180
  const matched = result.length

  const jaccard = matched / (docA + docB - matched)
  const weightedBidir = (2 * matched) / (docA + docB)

  console.log(`\nExpected similarity scores:`)
  console.log(`  Jaccard: ${(jaccard * 100).toFixed(1)}%`)
  console.log(`  Weighted Bidir: ${(weightedBidir * 100).toFixed(1)}%`)
} else {
  console.log(`\n❌ FAILED: 1-to-1 constraint not working!`)
  console.log(`  Expected 90 pairs, got ${result.length}`)
  console.log(`  Duplicates found: ${duplicateA + duplicateB}`)
}
