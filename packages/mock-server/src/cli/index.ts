#!/usr/bin/env node

import { main } from './main.js'

export { main } from './main.js'

process.exitCode = await main(process.argv.slice(2))
