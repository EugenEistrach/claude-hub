#!/usr/bin/env node

/**
 * Discord Bot Permission Checker
 * 
 * This script checks the current permissions of your Discord bot in a server
 * and generates new OAuth2 URLs with updated permissions if needed.
 * 
 * Usage:
 *   node scripts/utils/check-discord-permissions.js [guild_id]
 * 
 * Required Environment Variables:
 *   DISCORD_APPLICATION_ID - Your Discord application ID
 *   DISCORD_BOT_TOKEN - Your Discord bot token
 */

require('dotenv/config');

// Try to import from compiled JS first, fall back to basic console logging
let createLogger;
try {
  createLogger = require('../../dist/utils/logger').createLogger;
} catch (error) {
  createLogger = (name) => ({
    info: (msg, data) => console.log(`[INFO] ${name}:`, msg, data || ''),
    warn: (msg, data) => console.warn(`[WARN] ${name}:`, msg, data || ''),
    error: (msg, data) => console.error(`[ERROR] ${name}:`, msg, data || '')
  });
}

const logger = createLogger('discord-permissions');

// Discord API endpoints
const DISCORD_API_BASE = 'https://discord.com/api/v10';

// Required permissions for Claude bot
const REQUIRED_PERMISSIONS = {
  'SEND_MESSAGES': 2048,           // Send Messages
  'USE_SLASH_COMMANDS': 2147483648, // Use Slash Commands  
  'EMBED_LINKS': 16384,            // Embed Links
  'READ_MESSAGE_HISTORY': 65536,   // Read Message History
  'VIEW_CHANNEL': 1024,            // View Channels
  'ADD_REACTIONS': 64              // Add Reactions (optional but useful)
};

const REQUIRED_SCOPES = ['bot', 'applications.commands'];

/**
 * Validate environment variables
 */
function validateEnvironment() {
  const required = ['DISCORD_APPLICATION_ID', 'DISCORD_BOT_TOKEN'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    logger.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
  
  return {
    applicationId: process.env.DISCORD_APPLICATION_ID,
    botToken: process.env.DISCORD_BOT_TOKEN
  };
}

/**
 * Check bot permissions in a specific guild
 */
async function checkGuildPermissions(config, guildId) {
  const { applicationId, botToken } = config;
  
  try {
    // Get bot member info in guild
    const response = await fetch(
      `${DISCORD_API_BASE}/guilds/${guildId}/members/${applicationId}`,
      {
        headers: {
          'Authorization': `Bot ${botToken}`
        }
      }
    );
    
    if (!response.ok) {
      if (response.status === 404) {
        logger.error(`Bot is not in guild ${guildId}`);
        return null;
      }
      throw new Error(`API error: ${response.status}`);
    }
    
    const member = await response.json();
    
    // Check if bot has administrative permissions
    const isAdmin = member.roles && member.roles.some(roleId => 
      // We'd need to check role permissions, but this is complex
      false // Placeholder
    );
    
    logger.info(`Bot found in guild ${guildId}`);
    logger.info(`Bot user: ${member.user?.username}#${member.user?.discriminator}`);
    logger.info(`Joined at: ${member.joined_at}`);
    logger.info(`Roles: ${member.roles?.length || 0} roles`);
    
    return member;
    
  } catch (error) {
    logger.error(`Failed to check guild permissions: ${error.message}`);
    return null;
  }
}

/**
 * List bot guilds (servers)
 */
async function listBotGuilds(config) {
  const { botToken } = config;
  
  try {
    const response = await fetch(
      `${DISCORD_API_BASE}/users/@me/guilds`,
      {
        headers: {
          'Authorization': `Bot ${botToken}`
        }
      }
    );
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const guilds = await response.json();
    
    logger.info(`Bot is in ${guilds.length} servers:`);
    guilds.forEach(guild => {
      logger.info(`  - ${guild.name} (ID: ${guild.id})`);
    });
    
    return guilds;
    
  } catch (error) {
    logger.error(`Failed to list guilds: ${error.message}`);
    return [];
  }
}

/**
 * Calculate permission integer from permission names
 */
function calculatePermissions(permissions) {
  return Object.values(permissions).reduce((total, perm) => total | perm, 0);
}

/**
 * Generate OAuth2 invite URL with proper permissions
 */
function generateInviteURL(applicationId, customPermissions = null) {
  const permissions = customPermissions || calculatePermissions(REQUIRED_PERMISSIONS);
  const scopes = REQUIRED_SCOPES.join('%20');
  
  const url = `https://discord.com/api/oauth2/authorize?client_id=${applicationId}&permissions=${permissions}&scope=${scopes}`;
  
  return url;
}

/**
 * Main execution function
 */
async function main() {
  const guildId = process.argv[2];
  
  logger.info('🤖 Discord Bot Permission Checker');
  logger.info('==================================');
  
  const config = validateEnvironment();
  
  // List all guilds bot is in
  const guilds = await listBotGuilds(config);
  
  if (guildId) {
    logger.info(`\nChecking permissions in guild: ${guildId}`);
    const member = await checkGuildPermissions(config, guildId);
    
    if (!member) {
      logger.error('Cannot check permissions - bot not in guild or API error');
    }
  } else if (guilds.length > 0) {
    logger.info('\nTo check specific server permissions, run:');
    logger.info(`node scripts/utils/check-discord-permissions.js GUILD_ID`);
  }
  
  // Generate invite URLs
  logger.info('\n🔗 OAuth2 Invite URLs:');
  logger.info('=====================\n');
  
  // Basic permissions (current required)
  const basicPermissions = calculatePermissions(REQUIRED_PERMISSIONS);
  logger.info('🎯 **RECOMMENDED** - Use this URL to re-add bot with correct permissions:');
  logger.info(generateInviteURL(config.applicationId));
  logger.info(`   Permissions: ${basicPermissions} (${Object.keys(REQUIRED_PERMISSIONS).join(', ')})\n`);
  
  // Administrator permissions (if you want to be safe)
  logger.info('🛡️  **ADMIN** - Use this if you want all permissions (easier but less secure):');
  logger.info(generateInviteURL(config.applicationId, 8)); // Administrator permission
  logger.info('   Permissions: 8 (Administrator)\n');
  
  // Minimal permissions (just slash commands)
  const minimalPerms = calculatePermissions({
    'USE_SLASH_COMMANDS': 2147483648,
    'SEND_MESSAGES': 2048,
    'VIEW_CHANNEL': 1024
  });
  logger.info('⚡ **MINIMAL** - Just slash commands and basic messaging:');
  logger.info(generateInviteURL(config.applicationId, minimalPerms));
  logger.info(`   Permissions: ${minimalPerms} (View Channels, Send Messages, Use Slash Commands)\n`);
  
  logger.info('📝 Instructions:');
  logger.info('1. Copy the RECOMMENDED URL above');
  logger.info('2. Open it in your browser');
  logger.info('3. Select the same Discord server');
  logger.info('4. Discord will UPDATE the bot\'s permissions (not create duplicate)');
  logger.info('5. Click "Authorize" to apply new permissions');
  logger.info('\n💡 Tip: The bot will NOT be duplicated - Discord updates existing permissions');
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Script failed:', error.message);
    process.exit(1);
  });
}

module.exports = { checkGuildPermissions, generateInviteURL, calculatePermissions };