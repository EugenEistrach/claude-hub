#!/usr/bin/env node

/**
 * Discord Slash Command Registration Script
 * 
 * This script registers slash commands with Discord for the Claude Integration.
 * Run this once after setting up your Discord application.
 * 
 * Usage:
 *   npm run discord:register
 *   OR
 *   node scripts/setup/register-discord-commands.js
 * 
 * Required Environment Variables:
 *   DISCORD_APPLICATION_ID - Your Discord application ID
 *   DISCORD_BOT_TOKEN - Your Discord bot token
 * 
 * Optional Environment Variables:
 *   DISCORD_GUILD_ID - Register commands to specific guild (faster, for testing)
 */

require('dotenv/config');

// Try to import from compiled JS first, fall back to basic console logging
let createLogger;
try {
  createLogger = require('../../dist/utils/logger').createLogger;
} catch (error) {
  // Fallback to console logging if compiled version not available
  createLogger = (name) => ({
    info: (msg, data) => console.log(`[INFO] ${name}:`, msg, data || ''),
    warn: (msg, data) => console.warn(`[WARN] ${name}:`, msg, data || ''),
    error: (msg, data) => console.error(`[ERROR] ${name}:`, msg, data || '')
  });
}

const logger = createLogger('discord-setup');

// Discord API endpoints
const DISCORD_API_BASE = 'https://discord.com/api/v10';

/**
 * Discord slash command definitions
 */
const commands = [
  {
    name: 'claude',
    description: 'Execute a Claude Code command',
    options: [
      {
        name: 'command',
        description: 'The command for Claude to execute',
        type: 3, // STRING
        required: true
      },
      {
        name: 'repo',
        description: 'GitHub repository (owner/repo format)',
        type: 3, // STRING
        required: false
      },
      {
        name: 'issue',
        description: 'GitHub issue or PR number',
        type: 4, // INTEGER
        required: false
      },
      {
        name: 'branch',
        description: 'Git branch name',
        type: 3, // STRING
        required: false
      },
      {
        name: 'private',
        description: 'Make response visible only to you',
        type: 5, // BOOLEAN
        required: false
      }
    ]
  },
  {
    name: 'claude-help',
    description: 'Show help and examples for Claude commands',
    options: []
  },
  {
    name: 'claude-status',
    description: 'Check Claude service status and configuration',
    options: []
  }
];

/**
 * Validate required environment variables
 */
function validateEnvironment() {
  const required = ['DISCORD_APPLICATION_ID', 'DISCORD_BOT_TOKEN'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    logger.error(`Missing required environment variables: ${missing.join(', ')}`);
    logger.error('Please set these variables in your .env file or environment');
    process.exit(1);
  }
  
  return {
    applicationId: process.env.DISCORD_APPLICATION_ID,
    botToken: process.env.DISCORD_BOT_TOKEN,
    guildId: process.env.DISCORD_GUILD_ID // Optional
  };
}

/**
 * Register commands with Discord API
 */
async function registerCommands(config) {
  const { applicationId, botToken, guildId } = config;
  
  // Determine API endpoint (guild-specific or global)
  const endpoint = guildId 
    ? `${DISCORD_API_BASE}/applications/${applicationId}/guilds/${guildId}/commands`
    : `${DISCORD_API_BASE}/applications/${applicationId}/commands`;
  
  const scope = guildId ? `guild ${guildId}` : 'globally';
  
  logger.info(`Registering ${commands.length} commands ${scope}...`);
  
  try {
    const response = await fetch(endpoint, {
      method: 'PUT', // PUT replaces all commands
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(commands)
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Discord API error (${response.status}): ${error}`);
    }
    
    const registeredCommands = await response.json();
    
    logger.info(`✅ Successfully registered ${registeredCommands.length} commands ${scope}`);
    
    // Log registered commands
    registeredCommands.forEach(cmd => {
      logger.info(`  📋 /${cmd.name} - ${cmd.description}`);
    });
    
    if (guildId) {
      logger.info('💡 Guild commands are available immediately');
    } else {
      logger.info('⏳ Global commands may take up to 1 hour to propagate');
    }
    
    return registeredCommands;
    
  } catch (error) {
    logger.error('❌ Failed to register Discord commands:', error.message);
    
    if (error.message.includes('401')) {
      logger.error('🔑 Check your DISCORD_BOT_TOKEN - it may be invalid');
    }
    
    if (error.message.includes('404')) {
      logger.error('🔍 Check your DISCORD_APPLICATION_ID - application not found');
    }
    
    throw error;
  }
}

/**
 * List existing commands (for verification)
 */
async function listExistingCommands(config) {
  const { applicationId, botToken, guildId } = config;
  
  const endpoint = guildId 
    ? `${DISCORD_API_BASE}/applications/${applicationId}/guilds/${guildId}/commands`
    : `${DISCORD_API_BASE}/applications/${applicationId}/commands`;
  
  try {
    const response = await fetch(endpoint, {
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      logger.warn(`Could not fetch existing commands: ${response.status}`);
      return [];
    }
    
    const existingCommands = await response.json();
    
    if (existingCommands.length > 0) {
      logger.info(`📋 Found ${existingCommands.length} existing commands:`);
      existingCommands.forEach(cmd => {
        logger.info(`  - /${cmd.name} (ID: ${cmd.id})`);
      });
    } else {
      logger.info('📋 No existing commands found');
    }
    
    return existingCommands;
    
  } catch (error) {
    logger.warn('Could not list existing commands:', error.message);
    return [];
  }
}

/**
 * Main execution function
 */
async function main() {
  try {
    logger.info('🤖 Discord Slash Command Registration');
    logger.info('====================================');
    
    // Validate environment
    const config = validateEnvironment();
    
    // List existing commands
    await listExistingCommands(config);
    
    // Register new commands
    const registeredCommands = await registerCommands(config);
    
    logger.info('');
    logger.info('🎉 Discord command registration completed successfully!');
    logger.info('');
    logger.info('Next steps:');
    logger.info('1. Add your bot to a Discord server with "applications.commands" scope');
    logger.info('2. Set your webhook URL in Discord Developer Portal:');
    logger.info(`   https://your-domain.com/api/webhooks/discord`);
    logger.info('3. Test commands in Discord: /claude help');
    logger.info('');
    
  } catch (error) {
    logger.error('💥 Command registration failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { registerCommands, listExistingCommands };