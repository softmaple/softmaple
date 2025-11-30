#!/usr/bin/env node

/**
 * Script to analyze Playwright test performance and suggest optimizations
 * Run with: node scripts/analyze-test-performance.js
 */

const fs = require('fs');
const path = require('path');

// Read all spec files
const e2eDir = path.join(__dirname, '..', 'e2e');
const specFiles = fs.readdirSync(e2eDir).filter(f => f.endsWith('.spec.ts'));

console.log('\n🔍 E2E Test Analysis\n');
console.log('='.repeat(50));

let totalTests = 0;
let activeTests = 0;
let skippedTests = 0;
const testsByFile = {};

specFiles.forEach(file => {
  const filePath = path.join(e2eDir, file);
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Count tests
  const testMatches = content.match(/test\s*\(/g) || [];
  const skipMatches = content.match(/test\.skip\s*\(/g) || [];
  
  const fileActive = testMatches.length;
  const fileSkipped = skipMatches.length;
  const fileTotal = fileActive + fileSkipped;
  
  testsByFile[file] = {
    active: fileActive,
    skipped: fileSkipped,
    total: fileTotal
  };
  
  totalTests += fileTotal;
  activeTests += fileActive;
  skippedTests += fileSkipped;
});

// Display results
console.log('\n📊 Test Distribution by File:\n');
Object.entries(testsByFile)
  .sort((a, b) => b[1].total - a[1].total)
  .forEach(([file, stats]) => {
    const bar = '█'.repeat(Math.ceil(stats.active / 2));
    const skipBar = '░'.repeat(Math.ceil(stats.skipped / 2));
    console.log(`${file.padEnd(25)} ${bar}${skipBar} ${stats.active}/${stats.total} tests`);
  });

console.log('\n📈 Summary:\n');
console.log(`Total Tests: ${totalTests}`);
console.log(`Active Tests: ${activeTests} (${Math.round(activeTests/totalTests*100)}%)`);
console.log(`Skipped Tests: ${skippedTests} (${Math.round(skippedTests/totalTests*100)}%)`);

// Sharding recommendations
const currentShards = 6;
const testsPerShard = Math.ceil(activeTests / currentShards);

console.log('\n🎯 Sharding Analysis:\n');
console.log(`Current shards: ${currentShards}`);
console.log(`Tests per shard: ~${testsPerShard}`);
console.log(`Estimated time per shard: ~${testsPerShard * 0.5} minutes (assuming 30s per test)`);

// Optimization suggestions
console.log('\n💡 Optimization Suggestions:\n');

if (skippedTests > activeTests * 0.3) {
  console.log('⚠️  High number of skipped tests - consider implementing or removing them');
}

if (testsPerShard > 15) {
  const recommendedShards = Math.ceil(activeTests / 10);
  console.log(`⚠️  Consider increasing shards to ${recommendedShards} for better parallelization`);
}

// Find test files that might be slow
const largeTestFiles = Object.entries(testsByFile)
  .filter(([_, stats]) => stats.active > 10)
  .map(([file, _]) => file);

if (largeTestFiles.length > 0) {
  console.log('\n⚠️  Large test files that might benefit from splitting:');
  largeTestFiles.forEach(file => {
    console.log(`   - ${file} (${testsByFile[file].active} active tests)`);
  });
}

console.log('\n✅ Recommendations for 30-minute shard issue:\n');
console.log('1. Current setup: 6 shards with ~8-9 tests each');
console.log('2. If still slow, consider:');
console.log('   - Increasing to 8-10 shards');
console.log('   - Adding test-specific timeouts');
console.log('   - Running only critical tests in PR checks');
console.log('   - Using test.describe.parallel() for independent tests');
console.log('   - Caching Next.js build output between shards');
console.log('');
