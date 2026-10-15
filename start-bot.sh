#!/bin/bash
# Startup script for cPanel - run bot in polling mode
export NODE_ENV=production
export NODE_PATH=/home/$(whoami)/node_modules
npm start