#!/usr/bin/env node

/**
 * Creates deterministic text fixtures for the production AppImage walkthrough.
 *
 * Usage:
 *   node scripts/diagnostics/create-demo-nature-finances-research-files.js
 *   node scripts/diagnostics/create-demo-nature-finances-research-files.js --output "/tmp/demo-inbox"
 *   node scripts/diagnostics/create-demo-nature-finances-research-files.js --output "/tmp/demo-inbox" --clean
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_OUTPUT_DIR = path.join(os.homedir(), 'stratosort-demo', 'inbox');

const FIXTURES = {
  'wildlife-migration-patterns.txt': `Title: Wildlife Migration Patterns

This field brief summarizes migration corridors for caribou and monarch butterflies.
Key sections include seasonal movement, habitat pressure, and conservation zones.
Use this document for ecology and wildlife planning research.`,

  'rainforest-biodiversity-study.txt': `Title: Rainforest Biodiversity Study

This study reviews canopy species diversity, pollinator density, and restoration outcomes.
It compares sample plots in tropical forest regions and includes conservation recommendations.
Use this document for nature and biodiversity classification.`,

  'coral-reef-conservation.txt': `Title: Coral Reef Conservation

This report covers reef bleaching, marine habitat resilience, and coral recovery programs.
It includes reef monitoring metrics and ocean ecosystem protection notes.
Use this document for nature and conservation routing.`,

  'quarterly-profit-loss-statement.txt': `Title: Quarterly Profit and Loss Statement

Revenue, operating expenses, and net income are summarized for Q1.
The document includes gross margin tables, variance notes, and accounting commentary.
Use this file for finance and business statement categorization.`,

  'investment-portfolio-analysis.txt': `Title: Investment Portfolio Analysis

This analysis reviews asset allocation, risk exposure, and expected return profiles.
The report includes equity, bond, and cash position summaries for investor review.
Use this file for finance and investment routing.`,

  'tax-deduction-worksheet.txt': `Title: Tax Deduction Worksheet

Contains deductible expense categories, annual tax notes, and filing references.
Includes line-item calculations for business deductions and compliance reminders.
Use this file for finance and tax documentation.`,

  'climate-change-data-analysis.txt': `Title: Climate Change Data Analysis

This research memo analyzes long-term temperature trends and emissions data.
It includes statistical methods, data tables, and interpretation notes for climate science.
Use this document for scientific research categorization.`,

  'machine-learning-neural-networks.txt': `Title: Machine Learning Neural Networks

Technical notes on neural network architectures, model training, and evaluation metrics.
Includes backpropagation summaries and experiment tracking observations.
Use this document for technical research and model-development topics.`,

  'pharmaceutical-drug-trial-results.txt': `Title: Pharmaceutical Drug Trial Results

Clinical trial outcomes, efficacy comparisons, and adverse event summaries are included.
The report contains study protocol references and statistical confidence ranges.
Use this document for medical research and scientific analysis routing.`
};

function parseArgs(argv) {
  const args = { output: DEFAULT_OUTPUT_DIR, clean: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--output') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('Missing value for --output');
      }
      args.output = path.resolve(value);
      i += 1;
    } else if (token === '--clean') {
      args.clean = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function ensureCleanDirectory(targetDir, clean) {
  if (clean && fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  fs.mkdirSync(targetDir, { recursive: true });
}

function writeFixtures(targetDir) {
  const created = [];
  for (const [fileName, contents] of Object.entries(FIXTURES)) {
    const filePath = path.join(targetDir, fileName);
    fs.writeFileSync(filePath, `${contents}\n`, 'utf8');
    created.push(filePath);
  }
  return created;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  ensureCleanDirectory(args.output, args.clean);
  const createdFiles = writeFixtures(args.output);

  process.stdout.write(`Created ${createdFiles.length} demo files in ${args.output}\n`);
  for (const filePath of createdFiles) {
    process.stdout.write(`- ${filePath}\n`);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
