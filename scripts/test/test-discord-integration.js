#!/usr/bin/env node

/**
 * Discord Integration Validation Script
 * 
 * This script validates the Discord integration setup and tests key functionality.
 * 
 * Usage:
 *   npm run test:discord
 *   OR
 *   node scripts/test/test-discord-integration.js
 * 
 * Tests:
 *   - Environment variables
 *   - Discord API connectivity
 *   - Webhook endpoint health
 *   - Signature verification
 *   - Command registration status
 */

require('dotenv/config');
const { createLogger } = require('../../src/utils/logger');
const { execSync } = require('child_process');
const crypto = require('crypto');

const logger = createLogger('discord-test');

// Test configuration
const TEST_CONFIG = {
  serverUrl: process.env.API_URL || 'http://localhost:3002',
  timeout: 10000, // 10 seconds
  discordApiBase: 'https://discord.com/api/v10'
};

/**
 * Test results tracking
 */
const testResults = {
  passed: 0,
  failed: 0,
  tests: []
};

/**
 * Add test result
 */
function addTestResult(name, passed, message = '', details = null) {
  const result = { name, passed, message, details };
  testResults.tests.push(result);
  
  if (passed) {
    testResults.passed++;
    logger.info(`✅ ${name}: ${message}`);
  } else {
    testResults.failed++;
    logger.error(`❌ ${name}: ${message}`);
    if (details) {
      logger.error('   Details:', details);
    }
  }
}

/**
 * Test 1: Environment Variables
 */
function testEnvironmentVariables() {
  logger.info('🔍 Testing environment variables...');
  
  const required = [
    'DISCORD_APPLICATION_ID',
    'DISCORD_BOT_TOKEN', 
    'DISCORD_PUBLIC_KEY'
  ];
  
  const optional = [
    'DISCORD_AUTHORIZED_USERS',
    'DISCORD_GUILD_ID'
  ];
  
  let allPresent = true;
  const missing = [];
  const present = [];
  
  // Check required variables
  for (const key of required) {
    if (process.env[key]) {
      present.push(key);
    } else {
      missing.push(key);
      allPresent = false;
    }
  }
  
  // Check optional variables
  for (const key of optional) {
    if (process.env[key]) {
      present.push(`${key} (optional)`);
    }
  }
  
  addTestResult(
    'Environment Variables',
    allPresent,
    allPresent ? `All required variables present (${present.length} total)` : `Missing: ${missing.join(', ')}`,
    { present, missing }
  );
  
  return allPresent;
}

/**
 * Test 2: Discord API Connectivity
 */
async function testDiscordApiConnectivity() {
  logger.info('🌐 Testing Discord API connectivity...');
  
  if (!process.env.DISCORD_BOT_TOKEN) {
    addTestResult('Discord API', false, 'No bot token provided');
    return false;
  }
  
  try {
    const response = await fetch(`${TEST_CONFIG.discordApiBase}/users/@me`, {
      headers: {
        'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        'User-Agent': 'Claude-Webhook-Bot/1.0'
      }
    });
    
    if (response.ok) {
      const botInfo = await response.json();
      addTestResult(
        'Discord API',
        true,
        `Connected successfully as ${botInfo.username}#${botInfo.discriminator}`,
        { id: botInfo.id, username: botInfo.username }
      );
      return true;
    } else {
      const error = await response.text();
      addTestResult(
        'Discord API',
        false,
        `API error (${response.status})`,
        error
      );
      return false;
    }
  } catch (error) {
    addTestResult(
      'Discord API',
      false,
      'Connection failed',
      error.message
    );
    return false;
  }
}

/**
 * Test 3: Local Server Health
 */
async function testServerHealth() {
  logger.info('🏥 Testing local server health...');
  
  try {
    // Test main health endpoint
    const healthResponse = await fetch(`${TEST_CONFIG.serverUrl}/health`, {
      timeout: TEST_CONFIG.timeout
    });
    
    if (healthResponse.ok) {
      const health = await healthResponse.json();
      addTestResult(
        'Server Health',
        true,
        `Server is running (${health.status})`,
        health
      );
    } else {
      addTestResult(
        'Server Health',
        false,
        `Health check failed (${healthResponse.status})`
      );
      return false;
    }
    
    // Test Discord webhook endpoint
    const discordResponse = await fetch(`${TEST_CONFIG.serverUrl}/api/webhooks/discord/health`, {
      timeout: TEST_CONFIG.timeout
    });
    
    if (discordResponse.ok) {
      const discordHealth = await discordResponse.json();
      addTestResult(
        'Discord Endpoint',
        true,
        'Discord webhook endpoint is accessible',
        discordHealth
      );
      return true;
    } else {
      addTestResult(
        'Discord Endpoint',
        false,
        `Discord endpoint not accessible (${discordResponse.status})`
      );
      return false;
    }
    
  } catch (error) {
    addTestResult(
      'Server Health',
      false,
      'Cannot connect to local server',
      error.message
    );
    return false;
  }
}

/**
 * Test 4: Command Registration Status
 */
async function testCommandRegistration() {
  logger.info('📋 Testing command registration status...');
  
  if (!process.env.DISCORD_APPLICATION_ID || !process.env.DISCORD_BOT_TOKEN) {
    addTestResult('Command Registration', false, 'Missing Discord credentials');
    return false;
  }
  
  try {
    const { applicationId, botToken } = {
      applicationId: process.env.DISCORD_APPLICATION_ID,
      botToken: process.env.DISCORD_BOT_TOKEN
    };
    
    // Check global commands
    const globalEndpoint = `${TEST_CONFIG.discordApiBase}/applications/${applicationId}/commands`;
    const globalResponse = await fetch(globalEndpoint, {
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (globalResponse.ok) {
      const globalCommands = await globalResponse.json();
      
      const expectedCommands = ['claude', 'claude-help', 'claude-status'];
      const registeredCommands = globalCommands.map(cmd => cmd.name);
      const hasAllCommands = expectedCommands.every(cmd => registeredCommands.includes(cmd));
      
      addTestResult(
        'Command Registration',
        hasAllCommands,
        hasAllCommands 
          ? `All ${globalCommands.length} commands registered globally`
          : `Missing commands: ${expectedCommands.filter(cmd => !registeredCommands.includes(cmd)).join(', ')}`,
        { registered: registeredCommands, expected: expectedCommands }
      );
      
      return hasAllCommands;
    } else {
      addTestResult(
        'Command Registration',
        false,
        `Cannot fetch commands (${globalResponse.status})`
      );
      return false;
    }
    
  } catch (error) {
    addTestResult(
      'Command Registration',
      false,
      'Error checking command registration',
      error.message
    );
    return false;
  }
}

/**
 * Test 5: Signature Verification
 */
async function testSignatureVerification() {
  logger.info('🔐 Testing Discord signature verification...');
  
  if (!process.env.DISCORD_PUBLIC_KEY) {
    addTestResult('Signature Verification', false, 'No public key provided');
    return false;
  }
  
  try {
    // Test if we can import the verification dependencies
    const nacl = require('tweetnacl');
    
    addTestResult(
      'Signature Dependencies',
      true,
      'tweetnacl package is available'
    );
    
    // Test basic signature verification functionality
    const testMessage = 'test message';
    const testTimestamp = Date.now().toString();
    const testBody = testTimestamp + testMessage;
    
    // This tests that the verification logic can run (we can't test actual Discord signatures without Discord)
    const publicKeyBytes = Buffer.from(process.env.DISCORD_PUBLIC_KEY, 'hex');
    const isValidLength = publicKeyBytes.length === 32;
    
    addTestResult(
      'Signature Verification',
      isValidLength,
      isValidLength ? 'Public key format is valid' : 'Public key format is invalid (should be 64 hex characters)',
      { publicKeyLength: publicKeyBytes.length }
    );
    
    return isValidLength;
    
  } catch (error) {
    addTestResult(
      'Signature Verification',
      false,
      'Signature verification setup failed',
      error.message
    );
    
    if (error.message.includes('tweetnacl')) {
      logger.warn('💡 Install tweetnacl: npm install tweetnacl @types/tweetnacl');
    }
    
    return false;
  }
}

/**
 * Test 6: Docker Integration
 */
function testDockerIntegration() {
  logger.info('🐳 Testing Docker integration...');
  
  try {
    // Check if Docker is available
    execSync('docker --version', { stdio: 'pipe' });
    
    // Check if Claude container image exists
    const imageCheck = execSync('docker images claudecode:latest --format "{{.Repository}}:{{.Tag}}"', { 
      stdio: 'pipe',
      encoding: 'utf8'
    }).trim();
    
    if (imageCheck === 'claudecode:latest') {
      addTestResult(
        'Docker Integration',
        true,
        'Claude container image is available'
      );
      return true;
    } else {
      addTestResult(
        'Docker Integration',
        false,
        'Claude container image not found (run docker build or build command)'
      );
      return false;
    }
    
  } catch (error) {
    addTestResult(
      'Docker Integration',
      false,
      'Docker not available or container image missing',
      error.message
    );
    return false;
  }
}

/**
 * Test 7: Authorization Configuration
 */
function testAuthorizationConfig() {
  logger.info('👥 Testing authorization configuration...');
  
  const authorizedUsers = process.env.DISCORD_AUTHORIZED_USERS;
  
  if (!authorizedUsers) {
    addTestResult(
      'Authorization Config',
      false,
      'No authorized users configured (DISCORD_AUTHORIZED_USERS not set)',
      'This means anyone can use the bot. Set DISCORD_AUTHORIZED_USERS for security.'
    );
    return false;
  }
  
  const userIds = authorizedUsers.split(',').map(id => id.trim()).filter(id => id);
  const validIds = userIds.filter(id => /^\d{17,19}$/.test(id)); // Discord user IDs are 17-19 digits
  
  addTestResult(
    'Authorization Config',
    validIds.length === userIds.length,
    `${validIds.length}/${userIds.length} user IDs are valid`,
    { validIds, invalidIds: userIds.filter(id => !/^\d{17,19}$/.test(id)) }
  );
  
  return validIds.length === userIds.length;
}

/**
 * Generate test report
 */
function generateReport() {
  logger.info('');
  logger.info('📊 Discord Integration Test Report');
  logger.info('=================================');
  
  testResults.tests.forEach(test => {
    const status = test.passed ? '✅' : '❌';
    logger.info(`${status} ${test.name}: ${test.message}`);
  });
  
  logger.info('');
  logger.info(`Summary: ${testResults.passed} passed, ${testResults.failed} failed`);
  
  if (testResults.failed === 0) {
    logger.info('🎉 All tests passed! Discord integration is ready.');
    logger.info('');
    logger.info('Next steps:');
    logger.info('1. Register slash commands: node scripts/setup/register-discord-commands.js');
    logger.info('2. Set webhook URL in Discord Developer Portal');
    logger.info('3. Add bot to Discord server');
    logger.info('4. Test commands: /claude help');
  } else {
    logger.warn('⚠️  Some tests failed. Please resolve issues before proceeding.');
    
    const criticalFailures = testResults.tests.filter(test => 
      !test.passed && ['Environment Variables', 'Discord API', 'Server Health'].includes(test.name)
    );
    
    if (criticalFailures.length > 0) {
      logger.error('🚨 Critical failures detected. Discord integration will not work.');
    }
  }
  
  return testResults.failed === 0;
}

/**
 * Main test execution
 */
async function main() {
  logger.info('🤖 Discord Integration Validation');
  logger.info('================================');
  logger.info('');
  
  try {
    // Run all tests
    const envOk = testEnvironmentVariables();
    
    if (envOk) {
      await testDiscordApiConnectivity();
      await testServerHealth();
      await testCommandRegistration();
      await testSignatureVerification();
      testDockerIntegration();
      testAuthorizationConfig();
    } else {
      logger.warn('⚠️  Skipping API tests due to missing environment variables');
    }
    
    // Generate report
    const allPassed = generateReport();
    
    process.exit(allPassed ? 0 : 1);
    
  } catch (error) {
    logger.error('💥 Test execution failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { testEnvironmentVariables, testDiscordApiConnectivity, testServerHealth };