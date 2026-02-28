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
  'wildlife-migration-patterns.txt': `Category Hint: Nature
Title: Wildlife Migration Patterns

This nature report summarizes wildlife migration corridors for caribou and monarch butterflies.
Key sections include habitat pressure, biodiversity conservation zones, and ecosystem protection.
Primary domain: nature, ecology, wildlife, conservation.
Expected smart folder: Nature.`,

  'rainforest-biodiversity-study.txt': `Category Hint: Nature
Title: Rainforest Biodiversity Study

This nature study reviews rainforest biodiversity, canopy species diversity, and ecosystem restoration.
It compares tropical habitat samples and conservation outcomes for wildlife protection.
Primary domain: nature, biodiversity, rainforest, ecology.
Expected smart folder: Nature.`,

  'coral-reef-conservation.txt': `Category Hint: Nature
Title: Coral Reef Conservation

This nature report covers coral reef conservation, marine ecosystem resilience, and habitat restoration.
It includes reef biodiversity monitoring and ocean wildlife protection strategies.
Primary domain: nature, marine ecology, conservation.
Expected smart folder: Nature.`,

  'quarterly-profit-loss-statement.txt': `Category Hint: Finances
Title: Quarterly Profit and Loss Statement

This is a FINANCIAL document and accounting statement.
It summarizes quarterly revenue, operating expenses, gross margin, cash flow, liabilities, and net income.
The report contains accounting ledger references, finance controls, tax liabilities, and audit notes.
Primary domain: finance, accounting, profit and loss, financial reporting.
Expected smart folder: Finances.
Not related to nature, wildlife, rainforest, coral reef, or ecology.`,

  'investment-portfolio-analysis.txt': `Category Hint: Finances
Title: Investment Portfolio Analysis

This finance report reviews investment portfolio allocation across equities, bonds, and cash.
It includes risk-adjusted return metrics, portfolio performance, and financial planning notes.
Primary domain: finance, investment, portfolio management.
Expected smart folder: Finances.`,

  'tax-deduction-worksheet.txt': `Category Hint: Finances
Title: Tax Deduction Worksheet

This finance worksheet contains deductible expense categories, annual tax filing totals, and compliance notes.
It includes accounting line items for tax deductions and financial documentation.
Primary domain: finance, tax, accounting.
Expected smart folder: Finances.`,

  'climate-change-data-analysis.txt': `Category Hint: Research
Title: Climate Change Data Analysis

This scientific research memo analyzes climate change datasets, emissions trends, and statistical models.
It includes methodology, experimental assumptions, and data interpretation for research conclusions.
Primary domain: research, scientific analysis, data science.
Expected smart folder: Research.`,

  'machine-learning-neural-networks.txt': `Category Hint: Research
Title: Machine Learning Neural Networks

This technical research note describes neural network architectures, model training experiments, and evaluation metrics.
It includes hypothesis testing, reproducibility details, and research findings.
Primary domain: research, machine learning, experimentation.
Expected smart folder: Research.`,

  'pharmaceutical-drug-trial-results.txt': `Category Hint: Research
Title: Pharmaceutical Drug Trial Results

This medical research report summarizes clinical trial efficacy, adverse event data, and study methodology.
It includes statistical significance, protocol references, and peer-review research context.
Primary domain: research, pharmaceutical science, clinical studies.
Expected smart folder: Research.`
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
