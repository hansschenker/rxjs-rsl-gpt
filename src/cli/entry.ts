#!/usr/bin/env node

import { runRslCli } from "./main.js";

process.exitCode = await runRslCli(process.argv.slice(2));
