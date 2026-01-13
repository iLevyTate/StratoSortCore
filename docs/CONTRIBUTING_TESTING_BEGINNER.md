# Manual Testing Contributor Guide (Beginner)

**No coding experience required!** This guide walks you through testing El StratoSort and reporting
bugs. Your testing helps make the app better for everyone.

---

## Table of Contents

1. [What You'll Be Doing](#what-youll-be-doing)
2. [What You Need](#what-you-need)
3. [Step 1: Download and Install](#step-1-download-and-install)
4. [Step 2: First Launch Setup](#step-2-first-launch-setup)
5. [Step 3: Running Manual Tests](#step-3-running-manual-tests)
6. [Step 4: Reporting a Bug](#step-4-reporting-a-bug)
7. [Test Checklist](#test-checklist)
8. [FAQ](#faq)

---

## What You'll Be Doing

As a manual tester, you will:

- Install the app like a regular user would
- Try out different features
- Note anything that doesn't work correctly
- Report issues on GitHub so developers can fix them

**You don't need to write code or understand programming.** Just use the app and tell us what
breaks!

---

## What You Need

### Computer Requirements

| Requirement      | Minimum                           | Recommended   |
| ---------------- | --------------------------------- | ------------- |
| Operating System | Windows 10, macOS 10.15, or Linux | Windows 11    |
| RAM              | 6 GB                              | 8 GB or more  |
| Free Disk Space  | 6 GB                              | 12 GB or more |
| Internet         | Required for initial setup only   | -             |

### Before You Start

- [ ] Make sure you have enough disk space (check by opening File Explorer)
- [ ] Close other large applications to free up memory
- [ ] Have some test files ready (PDFs, images, documents)

---

## Step 1: Download and Install

### For Windows Users

1. **Open your web browser** (Chrome, Firefox, Edge, etc.)

2. **Go to the releases page:**

   ```
   https://github.com/iLevyTate/elstratosort/releases/latest
   ```

3. **Find the Windows download:**
   - Look for a file ending in `.exe`
   - It will be named something like `El-StratoSort-Setup-1.0.0.exe`
   - Click on it to download

4. **Run the installer:**
   - Open your Downloads folder
   - Double-click the `.exe` file you just downloaded
   - If Windows asks "Do you want to allow this app to make changes?", click **Yes**

5. **Follow the installation wizard:**
   - Click **Next** on each screen
   - Choose where to install (the default location is fine)
   - Click **Install**
   - Wait for it to finish
   - Click **Finish**

### For Mac Users

1. Go to `https://github.com/iLevyTate/elstratosort/releases/latest`
2. Download the `.dmg` file
3. Double-click the downloaded file
4. Drag the El StratoSort icon into your Applications folder
5. Open Applications and double-click El StratoSort

### For Linux Users

1. Go to `https://github.com/iLevyTate/elstratosort/releases/latest`
2. Download the `.AppImage` file
3. Open a terminal in your Downloads folder
4. Run: `chmod +x El-StratoSort-*.AppImage`
5. Run: `./El-StratoSort-*.AppImage`

---

## Step 2: First Launch Setup

When you first open El StratoSort, it needs to download some AI components. Here's what to expect:

### What Happens Automatically

1. **The app checks for Ollama** (the AI engine)
   - If not installed, the app will guide you to install it
   - This is a one-time setup

2. **AI models are downloaded** (~6 GB total)
   - This can take 10-30 minutes depending on your internet speed
   - You'll see a progress indicator
   - Don't close the app during this process!

3. **ChromaDB setup** (for search features)
   - This happens automatically in the background

### If Something Goes Wrong

- **Download stuck?** Check your internet connection and restart the app
- **Error message?** Write down exactly what it says - this is valuable bug info!
- **App won't open?** Try running as Administrator (right-click > Run as administrator)

---

## Step 3: Running Manual Tests

Now for the fun part - testing the app! Work through these tests one at a time.

### Test Category A: Basic File Analysis

**Test A1: Analyze a PDF**

1. Click the **Discover** tab at the top
2. Click **Select Content** (or the folder icon)
3. Choose a PDF file from your computer
4. Wait for analysis to complete
5. Check: Did it show a summary? Did it suggest a category?

**What to look for:**

- Did the file appear in the list?
- Is there a confidence score?
- Did the app crash or freeze?

**Test A2: Analyze an Image**

1. Click **Select Content**
2. Choose a photo or screenshot
3. Wait for analysis

**What to look for:**

- Did it recognize what's in the image?
- Were relevant keywords extracted?

**Test A3: Analyze Multiple Files**

1. Click **Select Content**
2. Select 5-10 different files (mix of PDFs, images, documents)
3. Watch the progress

**What to look for:**

- Does the progress bar move?
- Do all files get analyzed?
- Can you cancel if needed?

### Test Category B: Organization Features

**Test B1: Review a Suggestion**

1. After analyzing a file, click on it
2. Look at the suggested folder/category

**What to look for:**

- Is the suggestion reasonable?
- Can you see the AI's reasoning?

**Test B2: Move a File**

1. Select an analyzed file
2. Click **Organize** or **Apply**
3. Check if the file moved to the suggested location

**Test B3: Undo a Move**

1. After moving a file, click **Undo**
2. Check if the file returned to its original location

### Test Category C: Search Features

**Test C1: Semantic Search**

1. Press `Ctrl + K` (or `Cmd + K` on Mac)
2. Type a search term (like "receipt" or "photo")
3. Look at the results

**What to look for:**

- Do relevant files appear?
- Can you switch between Graph and List views?

### Test Category D: Edge Cases

These tests check how the app handles unusual situations:

**Test D1: Empty/Corrupt File**

1. Create an empty text file (0 bytes)
2. Try to analyze it

**What to look for:**

- Does the app handle it gracefully?
- Is there a clear error message?

**Test D2: Large File**

1. Find a large file (50MB or bigger)
2. Try to analyze it

**What to look for:**

- Does the app warn you?
- Does it crash or freeze?

**Test D3: Offline Mode**

1. Disconnect from the internet
2. Try analyzing files

**What to look for:**

- Does it still work? (It should - AI is local!)

---

## Step 4: Reporting a Bug

Found something wrong? Great! Here's how to report it so developers can fix it.

### Creating a GitHub Account (If You Don't Have One)

1. Go to `https://github.com/signup`
2. Enter your email address
3. Create a password
4. Choose a username
5. Verify your email
6. You're done!

### Submitting a Bug Report

#### Step 4a: Go to the Issues Page

1. Open your browser
2. Go to: `https://github.com/iLevyTate/elstratosort/issues`
3. Click the green **New issue** button

#### Step 4b: Fill Out the Bug Report

Use this template - copy and paste it, then fill in your information:

```
## Bug Report

### System Information
- **Operating System:** [e.g., Windows 11, macOS 14, Ubuntu 22.04]
- **El StratoSort Version:** [e.g., 1.0.0 - find this in Settings or Help > About]
- **RAM:** [e.g., 8 GB]

### Test Being Performed
- **Test ID:** [e.g., A1 - Analyze a PDF]
- **Test Category:** [e.g., Basic File Analysis]

### What Happened
[Describe what went wrong. Be as specific as possible.]

### What Should Have Happened
[Describe what you expected to happen.]

### Steps to Reproduce
1. [First step you took]
2. [Second step you took]
3. [Third step you took]
4. [etc.]

### Screenshots
[If possible, add screenshots. You can drag and drop images directly into this text box.]

### Additional Notes
[Anything else that might be helpful - error messages, things you tried, etc.]
```

#### Step 4c: Example Bug Report

Here's what a good bug report looks like:

```
## Bug Report

### System Information
- **Operating System:** Windows 11 Home
- **El StratoSort Version:** 1.0.0
- **RAM:** 16 GB

### Test Being Performed
- **Test ID:** A3 - Batch Analysis
- **Test Category:** Basic File Analysis

### What Happened
When I selected 10 files for batch analysis, the app froze at 70% and
I had to force close it. The progress bar stopped moving and I couldn't
click any buttons.

### What Should Have Happened
All 10 files should have been analyzed and the results displayed.

### Steps to Reproduce
1. Opened El StratoSort
2. Clicked on "Discover" tab
3. Clicked "Select Content"
4. Selected 10 PDF files (ranging from 1MB to 15MB each)
5. Progress bar moved to about 70%
6. App became unresponsive

### Screenshots
[Screenshot of the frozen app showing progress bar at 70%]

### Additional Notes
- I waited about 5 minutes but nothing changed
- Task Manager showed the app was "Not Responding"
- This happened twice when I tried again
- My antivirus (Windows Defender) was running in the background
```

#### Step 4d: Submit

1. Review your bug report
2. Click **Submit new issue**
3. Done! A developer will see it and respond

### Tips for Great Bug Reports

- **Be specific:** "It crashed" is less helpful than "It crashed after I clicked the Organize
  button"
- **Include steps:** Can you make it happen again? Write down exactly what you did
- **Add screenshots:** A picture is worth a thousand words
- **Note error messages:** Copy the exact text of any error messages
- **One bug per report:** If you found multiple bugs, create separate reports

---

## Test Checklist

Use this checklist to track your progress. Copy it to a text file on your computer:

```
MANUAL TESTING CHECKLIST
========================

Installation
[ ] Downloaded installer successfully
[ ] Installation completed without errors
[ ] App launches correctly

First Run
[ ] AI components downloaded successfully
[ ] No errors during setup

Basic Analysis (Category A)
[ ] A1: Single PDF analysis works
[ ] A2: Image analysis works
[ ] A3: Batch analysis works
[ ] A4: Cancel button works

Organization (Category B)
[ ] B1: Can view suggestions
[ ] B2: File move works
[ ] B3: Undo works

Search (Category C)
[ ] C1: Search finds relevant files
[ ] C2: Graph view works
[ ] C3: List view works

Edge Cases (Category D)
[ ] D1: Empty file handled gracefully
[ ] D2: Large file handled gracefully
[ ] D3: Offline mode works

BUGS FOUND:
-----------
1.
2.
3.
```

---

## FAQ

### Do I need to test everything?

No! Test whatever you can. Even testing just one feature helps.

### What if I'm not sure it's a bug?

Report it anyway! It's better to report something that turns out to be normal than to miss a real
bug.

### How long should testing take?

- Quick test: 15-30 minutes
- Full test: 1-2 hours
- Go at your own pace!

### Can I suggest new features?

Yes! Use the same GitHub Issues page but label it as a "Feature Request" instead of a bug.

### What if I find the same bug someone else reported?

Add a comment to the existing issue saying "I can confirm this bug" and add any extra details you
noticed.

### How do I know my bug report was seen?

You'll get email notifications when developers respond. You can also check the issue page.

---

## Thank You!

Every bug you find makes El StratoSort better. Thank you for contributing to open source!

Questions? Open an issue on GitHub or check the [main documentation](./README.md).
