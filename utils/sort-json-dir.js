#!/usr/bin/env node
/**
 * Sort all JSON files in a given directory using sort-json.
 * Usage: node sort-json-dir.js /path/to/json/files
 */

const fs = require("fs");
const path = require("path");
const sortJson = require("sort-json");
const { createLogger } = require("./cli-log");

const log = createLogger("sort-json-dir");
const retrySignal = new Int32Array(new SharedArrayBuffer(4));

function retryFileOperation(operation, filePath, maxAttempts = 8) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return operation();
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts) break;
      // Windows indexers and antivirus scanners can briefly hold a generated
      // JSON file after it is replaced. Retry the I/O operation instead of
      // silently leaving non-canonical source behind.
      Atomics.wait(retrySignal, 0, 0, 25 * attempt);
    }
  }
  throw new Error(`${lastError.message} (${filePath}; ${maxAttempts} attempts)`);
}

// Validate CLI argument
if (process.argv.length < 3) {
  log.error("Please provide a directory path");
  process.exit(1);
}

const dirPath = path.resolve(process.argv[2]);

// Check if directory exists
if (!fs.existsSync(dirPath) || !fs.lstatSync(dirPath).isDirectory()) {
  log.error(`The path "${dirPath}" is not a valid directory`);
  process.exit(1);
}

try {
  // Read all files in directory
  const files = fs.readdirSync(dirPath);

  // Filter only .json files
  const jsonFiles = files.filter((file) => file.toLowerCase().endsWith(".json"));

  if (jsonFiles.length === 0) {
    log.info("No JSON files found in the directory");
    process.exit(0);
  }

  let failures = 0;
  jsonFiles.forEach((file) => {
    const filePath = path.join(dirPath, file);

    try {
      // Read and parse JSON
      const source = retryFileOperation(() => fs.readFileSync(filePath, "utf8"), filePath);
      const data = JSON.parse(source);

      // Sort JSON keys
      const sortedData = sortJson(data, { ignoreCase: true, depth: 100 });

      // Write back to file (pretty-printed)
      retryFileOperation(
        () => fs.writeFileSync(filePath, JSON.stringify(sortedData, null, 2) + "\n", "utf8"),
        filePath
      );

      log.info(`Sorted ${file}`);
    } catch (err) {
      failures += 1;
      log.error(`Error processing "${file}": ${err.message}`);
    }
  });

  if (failures) {
    log.error(`Failed to sort ${failures} JSON file(s)`);
    process.exitCode = 1;
  } else {
    log.success("All JSON files processed");
  }
} catch (err) {
  log.error(`Failed to read directory: ${err.message}`);
  process.exit(1);
}
