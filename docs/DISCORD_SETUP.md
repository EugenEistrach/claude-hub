# Discord Integration Setup Guide

## Overview

This guide covers the manual setup steps required to enable Discord integration with your Claude webhook system. The integration uses Discord slash commands to execute Claude Code commands, similar to the existing GitHub integration.

## Prerequisites

- Running Claude webhook system (GitHub integration working)
- Discord account with server administrator permissions
- Access to Discord Developer Portal

## Step 1: Create Discord Application

### 1.1 Access Discord Developer Portal
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application"
3. Enter application name (e.g., "Claude Code Bot")
4. Accept terms and click "Create"

### 1.2 Configure Bot
1. Go to "Bot" section in left sidebar
2. Click "Add Bot" → "Yes, do it!"
3. **Save Bot Token** (you'll need this later)
4. Under "Privileged Gateway Intents", enable:
   - Message Content Intent (if you plan to add message events later)
5. Under "Bot Permissions", select:
   - Send Messages
   - Use Slash Commands
   - Embed Links
   - Read Message History

### 1.3 Get Application Credentials
Copy these values (you'll need them for environment variables):

**From "General Information" tab:**
- Application ID
- Public Key

**From "Bot" tab:**
- Token

## Step 2: Configure Environment Variables

### 2.1 Update .env File
Add these variables to your `.env` file:

```bash
# Discord Integration Settings
DISCORD_APPLICATION_ID=your_application_id_here
DISCORD_BOT_TOKEN=your_bot_token_here  
DISCORD_PUBLIC_KEY=your_public_key_here
DISCORD_AUTHORIZED_USERS=123456789012345678,987654321098765432
```

### 2.2 Get Discord User IDs
To get Discord user IDs for `DISCORD_AUTHORIZED_USERS`:

1. Enable Developer Mode in Discord:
   - User Settings → Advanced → Developer Mode (toggle on)
2. Right-click on user in Discord → "Copy ID"
3. Add comma-separated list of user IDs

## Step 3: Install Dependencies

The Discord integration requires additional npm packages:

```bash
npm install tweetnacl @types/tweetnacl
```

**Note:** These are required for Discord's Ed25519 signature verification.

## Step 4: Register Slash Commands

### 4.1 Run Registration Script
```bash
# Make sure your .env file has Discord credentials
node scripts/setup/register-discord-commands.js
```

### 4.2 Verify Registration
The script will output:
```
✅ Successfully registered 3 commands globally
  📋 /claude - Execute a Claude Code command
  📋 /claude-help - Show help and examples for Claude commands  
  📋 /claude-status - Check Claude service status and configuration
```

**Note:** Global commands take up to 1 hour to propagate. For faster testing, you can register guild-specific commands by setting `DISCORD_GUILD_ID` in your environment.

## Step 5: Set Up Webhook URL

### 5.1 Configure Interactions Endpoint
1. In Discord Developer Portal, go to "General Information"
2. Set "Interactions Endpoint URL" to:
   ```
   https://your-domain.com/api/webhooks/discord
   ```
3. Click "Save Changes"

Discord will verify your endpoint. Make sure your server is running!

### 5.2 Webhook URL Requirements
- Must be HTTPS (not HTTP)
- Must respond to verification requests
- Must be publicly accessible

**For local development:**
- Use ngrok: `ngrok http 3002`
- Set webhook URL to: `https://abc123.ngrok.io/api/webhooks/discord`

## Step 6: Add Bot to Discord Server

### 6.1 Generate OAuth2 URL
1. Go to "OAuth2" → "URL Generator" in Discord Developer Portal
2. Select scopes:
   - `bot`
   - `applications.commands`
3. Select bot permissions:
   - Send Messages
   - Use Slash Commands
   - Embed Links
   - Read Message History
4. Copy generated URL

### 6.2 Add Bot to Server
1. Open generated URL in browser
2. Select Discord server
3. Click "Authorize"
4. Complete captcha if prompted

## Step 7: Test Integration

### 7.1 Restart Application
```bash
# Stop current instance
docker-compose down

# Start with Discord integration
docker-compose up -d

# Check logs
docker-compose logs -f webhook
```

### 7.2 Test Commands
In Discord, try these commands:

```
/claude help
/claude check docker configuration
/claude-status
/claude-help
```

### 7.3 Expected Behavior
1. Type `/claude` → Discord shows command options
2. Execute command → Bot responds with "🤖 Claude is analyzing..."
3. After processing → Response updates with results

## Troubleshooting

### Common Issues

#### "Interaction failed" in Discord
- Check application logs: `docker-compose logs webhook`
- Verify webhook URL is correct and accessible
- Ensure DISCORD_PUBLIC_KEY is correct

#### Commands not appearing
- Wait up to 1 hour for global commands
- Or use guild-specific commands with DISCORD_GUILD_ID
- Check bot has proper permissions in server

#### "Unknown interaction" errors
- Verify Discord signature verification
- Check DISCORD_PUBLIC_KEY matches Discord Developer Portal
- Ensure tweetnacl package is installed

#### Bot not responding
- Check DISCORD_BOT_TOKEN is correct
- Verify bot is in the Discord server
- Check DISCORD_AUTHORIZED_USERS includes your Discord user ID

### Debug Mode
Enable detailed logging by setting:
```bash
NODE_ENV=development
DEBUG=discord:*
```

### Health Check
Test the Discord endpoint directly:
```bash
curl -X GET https://your-domain.com/api/webhooks/discord/health
```

Should return:
```json
{
  "status": "ok",
  "service": "discord",
  "timestamp": "2024-..."
}
```

## Security Considerations

### Environment Variables
- Never commit Discord tokens to version control
- Use file-based secrets in production:
  ```bash
  DISCORD_BOT_TOKEN_FILE=/run/secrets/discord_bot_token
  ```

### User Authorization
- Always configure DISCORD_AUTHORIZED_USERS
- Remove unauthorized users immediately
- Monitor application logs for unauthorized attempts

### Webhook Security
- Discord uses Ed25519 signature verification
- Never disable signature verification in production
- Keep DISCORD_PUBLIC_KEY secure

## Advanced Configuration

### Guild-Specific Commands (Faster Testing)
```bash
# Register commands to specific server only
DISCORD_GUILD_ID=your_server_id node scripts/setup/register-discord-commands.js
```

### Custom Command Options
Edit `scripts/setup/register-discord-commands.js` to add custom command options.

### Multiple Servers
To use the bot in multiple servers:
1. Generate OAuth2 URL as above
2. Add bot to each server individually
3. Commands work across all servers

### Repository Context
Configure default repositories per Discord server by editing the Discord service configuration.

## Next Steps

After successful setup:

1. **Configure Repository Mapping**: Set default repositories for Discord channels
2. **User Training**: Share command usage with team members
3. **Monitoring**: Set up alerts for Discord integration health
4. **Scaling**: Consider rate limiting for high-traffic servers

## Support

If you encounter issues:

1. Check application logs: `docker-compose logs webhook`
2. Verify all environment variables are set correctly
3. Test webhook endpoint accessibility
4. Review Discord Developer Portal settings

For Discord API issues, refer to [Discord Developer Documentation](https://discord.com/developers/docs/).