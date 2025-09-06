#!/usr/bin/env node

/**
 * prepare-release.js
 * 
 * This script creates a git tag for a new release without modifying any files.
 * It's designed to work with a GitHub Actions workflow that will:
 * 1. Build the plugin
 * 2. Create a draft release with the compiled files
 * 3. Update manifest.json only when the release is published
 * 
 * Usage: npm run pre-release X.Y.Z
 * Example: npm run pre-release 1.3.17
 * 
 * The script will:
 * - Verify there are no uncommitted changes
 * - Check if tag already exists
 * - Create a git tag with the specified version
 * - Push the tag to trigger GitHub Actions
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Get version from command line
const version = process.argv[2];

if (!version) {
    console.error('❌ Please provide a version number: npm run pre-release X.Y.Z');
    process.exit(1);
}

// Support both formats: 1.3.17 and v1.3.17
const versionRegex = /^v?\d+\.\d+\.\d+$/;
if (!versionRegex.test(version)) {
    console.error('❌ Version must be in format X.Y.Z or vX.Y.Z');
    process.exit(1);
}

// Normalize version (remove 'v' prefix if present for consistency)
const cleanVersion = version.replace(/^v/, '');
const tagName = cleanVersion;  // or use `v${cleanVersion}` if you prefer v-prefix

// Get current version from manifest.json for comparison
const manifestPath = path.join(process.cwd(), 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const currentVersion = manifest.version;

console.log(`\n📦 Current version: ${currentVersion}`);
console.log(`🚀 Creating release: ${cleanVersion}\n`);

try {
    // Check if there are uncommitted changes
    const status = execSync('git status --porcelain').toString();
    if (status) {
        console.error('⚠️  You have uncommitted changes. Please commit or stash them first.');
        console.error('\nUncommitted files:');
        console.error(status);
        process.exit(1);
    }
    
    // Check if tag already exists locally
    try {
        execSync(`git rev-parse ${tagName}`, { stdio: 'pipe' });
        console.error(`❌ Tag ${tagName} already exists locally.`);
        console.error(`   To delete it: git tag -d ${tagName}`);
        process.exit(1);
    } catch {
        // Tag doesn't exist locally, which is good
    }
    
    // Check if tag exists on remote
    try {
        execSync(`git ls-remote --tags origin refs/tags/${tagName}`, { stdio: 'pipe' }).toString();
        if (execSync(`git ls-remote --tags origin refs/tags/${tagName}`).toString()) {
            console.error(`❌ Tag ${tagName} already exists on remote.`);
            console.error(`   This version has already been released.`);
            process.exit(1);
        }
    } catch {
        // Tag doesn't exist on remote, which is good
    }
    
    // Ensure we're on the latest master/main
    console.log('📡 Fetching latest from remote...');
    execSync('git fetch', { stdio: 'inherit' });
    
    const currentBranch = execSync('git branch --show-current').toString().trim();
    const remoteBranch = `origin/${currentBranch}`;
    const behind = execSync(`git rev-list HEAD..${remoteBranch} --count`).toString().trim();
    
    if (behind !== '0') {
        console.warn(`⚠️  Your branch is ${behind} commits behind ${remoteBranch}.`);
        console.warn('   Consider pulling latest changes first: git pull');
        // Optional: uncomment to make this a hard requirement
        // process.exit(1);
    }
    
    // Create tag for the release (WITHOUT modifying any files)
    execSync(`git tag -a ${tagName} -m "Release ${cleanVersion}"`, { stdio: 'inherit' });
    console.log(`✅ Created tag ${tagName}`);
    
    // Push the tag to trigger GitHub Actions
    console.log('\n📤 Pushing tag to remote...');
    execSync(`git push origin ${tagName}`, { stdio: 'inherit' });
    console.log(`✅ Pushed tag ${tagName} to remote`);
    
    console.log(`\n🎉 Release tag ${cleanVersion} created successfully!`);
    console.log('\n📝 Next steps:');
    console.log('1. ⚙️  GitHub Actions will build and create a DRAFT release');
    console.log('2. 👀 Review the draft release on GitHub');
    console.log('3. 📢 When you publish it, manifest.json will be automatically updated');
    console.log('\n🔗 View the workflow at:');
    console.log(`   https://github.com/xRyul/obsidian-image-converter/actions`);
    
} catch (error) {
    console.error('\n❌ Error during release preparation:', error.message);
    
    // Try to clean up the tag if it was created
    try {
        execSync(`git tag -d ${tagName}`, { stdio: 'pipe' });
        console.log('🧹 Cleaned up local tag');
    } catch {
        // Silently ignore if tag cleanup fails
    }
    
    process.exit(1);
}
