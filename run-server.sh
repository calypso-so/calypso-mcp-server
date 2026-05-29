#!/bin/bash

# Calypso MCP Server Run Script

echo "Starting Calypso MCP Server..."

# Check if the dist directory exists, if not, build the project
if [ ! -d "./dist" ]; then
    echo "Dist directory not found. Building project..."
    npm run build
fi

# Check if CALYPSO_API_KEY is set
if [ -z "$CALYPSO_API_KEY" ]; then
    # Try to load from .env file
    if [ -f ".env" ]; then
        export $(grep -v '^#' .env | xargs)
    fi
    
    # Check again if CALYPSO_API_KEY is set
    if [ -z "$CALYPSO_API_KEY" ]; then
        echo "Error: CALYPSO_API_KEY environment variable not set."
        echo "Please set your API key using: export CALYPSO_API_KEY=sk-..."
        echo "Or create a .env file with CALYPSO_API_KEY=sk-..."
        exit 1
    fi
fi

# Run the server
echo "Running server..."
node dist/index.js 