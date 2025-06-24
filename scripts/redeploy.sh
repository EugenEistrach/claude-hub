#!/bin/bash
set -e

echo "🔄 Starting complete redeploy of Claude Webhook services..."

# Stop all services
echo "⬇️ Stopping all services..."
docker-compose down

# Remove any orphaned containers
echo "🧹 Cleaning up orphaned containers..."
docker-compose down --remove-orphans

# Build Claude Code container first (separate from docker-compose)
echo "🏗️ Building Claude Code container from scratch..."
docker build -f Dockerfile.claudecode -t claudecode:latest --no-cache .

# Build all docker-compose images from scratch (no cache)
echo "🏗️ Building webhook service Docker images from scratch..."
docker-compose build --no-cache

# Pull any updated base images
echo "📥 Pulling latest base images..."
docker-compose pull

# Start all services in detached mode
echo "⬆️ Starting all services in detached mode..."
docker-compose up -d

# Wait a moment for services to start
echo "⏳ Waiting for services to initialize..."
sleep 3

# Show status
echo "📊 Service status:"
docker-compose ps

# Show recent logs (non-blocking)
echo "📋 Recent logs:"
docker-compose logs --tail=20

echo "✅ Redeploy complete! Services are running in the background."
echo "💡 To view live logs: docker-compose logs -f"
echo "💡 To stop services: docker-compose down"