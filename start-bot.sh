#!/bin/bash
# Startup script for cPanel - run bot in webhook mode
export NODE_ENV=production
export CPANEL=true
export NODE_PATH=/home/$(whoami)/node_modules
npm start