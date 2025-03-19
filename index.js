const inquirer = require('inquirer');
const simpleGit = require('simple-git');
const fs = require('fs');
const path = require('path');
const winston = require('winston');

// Initialize git instance
const git = simpleGit();

// Configure winston logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.simple()
  ),
  transports: [
    new winston.transports.Console({ format: winston.format.combine(winston.format.colorize(), winston.format.simple()) })
  ],
});

// Function to sanitize and change invalid characters in folder name
const sanitizeFolderName = (name) => {
  return name.replace(/[<>:"/\\|?*]/g, '_');  // Replace invalid characters with  "_"
}

// Function to clone a branch into a subfolder
const cloneBranchToFolder = async (repoUrl, branchName, parentFolderPath) => {
  try {
    const sanitizedBranchName = sanitizeFolderName(branchName);
    const branchFolderPath = path.join(parentFolderPath, sanitizedBranchName);

    // Check if the subfolder already exists, if so, skip cloning
    if (fs.existsSync(branchFolderPath)) {
      logger.info(`The subfolder ${branchFolderPath} already exists. Skipping branch cloning.`);
      return;  // If the folder exists, skip cloning this branch
    }

    // Create a new subfolder for the branch
    fs.mkdirSync(branchFolderPath, { recursive: true });
    logger.info(`Created subfolder ${branchFolderPath}`);

    // Initialize git repository in the subfolder
    logger.info(`Initializing git repository in ${branchFolderPath}`);
    await git.cwd(branchFolderPath).init();

    // Check if remote exists, if so, update remote URL
    const remotes = await git.cwd(branchFolderPath).raw(['remote', 'show']);
    if (remotes.includes('origin')) {
      // If 'origin' remote exists, update remote URL
      logger.info(`Remote 'origin' exists, updating remote URL.`);
      await git.cwd(branchFolderPath).raw(['remote', 'set-url', 'origin', repoUrl]);
    } else {
      // If remote does not exist, add it
      logger.info(`Adding new remote 'origin'.`);
      await git.cwd(branchFolderPath).raw(['remote', 'add', 'origin', repoUrl]);
    }

    // Perform fetch of all remote branches
    await git.cwd(branchFolderPath).fetch();

    // Checkout the branch into the subfolder
    logger.info(`Checking out branch ${branchName} into subfolder ${branchFolderPath}`);
    await git.cwd(branchFolderPath).checkout([branchName]);

    logger.info(`Branch ${branchName} has been checked out into ${branchFolderPath}`);
  } catch (error) {
    logger.error(`Error cloning branch ${branchName}:`, error);
  }
};

// Function to clone repository into a subfolder for each branch
const cloneRepository = async (repoUrl, parentFolderPath, repoName, cloneAllBranches) => {
  try {
    const repoFolderPath = path.join(parentFolderPath, repoName);

    // Check if the repository folder exists, if not, create it
    if (!fs.existsSync(repoFolderPath)) {
      logger.info(`The folder ${repoFolderPath} does not exist. Creating it...`);
      fs.mkdirSync(repoFolderPath, { recursive: true });
    }

    // Initialize Git repository in the repository folder (if not already initialized)
    logger.info(`Initializing git repository in folder ${repoFolderPath}...`);
    await git.cwd(repoFolderPath).init();

    // Check if remote exists, if so, update remote URL
    const remotes = await git.cwd(repoFolderPath).raw(['remote', 'show']);
    if (remotes.includes('origin')) {
      // If 'origin' remote exists, update remote URL
      logger.info(`Remote 'origin' exists, updating remote URL.`);
      await git.cwd(repoFolderPath).raw(['remote', 'set-url', 'origin', repoUrl]);
    } else {
      // If remote does not exist, add it
      logger.info(`Adding new remote 'origin'.`);
      await git.cwd(repoFolderPath).raw(['remote', 'add', 'origin', repoUrl]);
    }

    // Get remote branch information using 'ls-remote' command
    logger.info('Fetching remote branch information...');
    const remoteBranches = await git.cwd(repoFolderPath).raw(['ls-remote', '--refs', repoUrl]);

    if (!remoteBranches) {
      logger.warn('Could not fetch branch information from the remote repository.');
      return;
    }

    const remoteBranchNames = remoteBranches
      .split('\n')
      .map(line => line.split('\t')[1])  // Split branch name
      .filter(branch => branch && branch.startsWith('refs/heads/'))  // Filter valid branches
      .map(branch => branch.replace('refs/heads/', ''));  // Extract branch name only

    if (remoteBranchNames.length === 0) {
      logger.warn('No remote branches found.');
      return;
    }

    logger.info('Remote branches:', remoteBranchNames);

    // If option to clone all branches is selected, clone each branch into subfolder
    if (cloneAllBranches) {
      for (const branchName of remoteBranchNames) {
        await cloneBranchToFolder(repoUrl, branchName, repoFolderPath);
      }
    } else {
      // If only main branch (main or master) is selected, clone that branch
      const mainBranch = remoteBranchNames.includes('main') ? 'main' : 'master';
      await cloneBranchToFolder(repoUrl, mainBranch, repoFolderPath);
    }

  } catch (error) {
    logger.error('Error cloning repository:', error);
  }
};

// Use createPromptModule to create a new prompt
const prompt = inquirer.createPromptModule();

// Prompt user for GitHub URL and destination folder
prompt([
  {
    type: 'input',
    name: 'repoUrl',
    message: 'Enter the URL of the GitHub repository (use SSH or HTTPS):',
    validate: function(value) {
      if (value.match(/^git@github.com:.*\/.*\.git$/) || value.match(/^https:\/\/github.com\/.*\/.*\.git$/)) {
        return true;
      }
      return 'Please enter a valid GitHub URL (SSH or HTTPS).';
    },
  },
  {
    type: 'input',
    name: 'parentFolderPath',
    message: 'Enter the parent folder name where you want to save all source code (e.g., git-clone):',
    default: './git-clone',
  },
  {
    type: 'input',
    name: 'repoFolderName',
    message: 'Enter the folder name for the repository you want to clone (e.g., repo1):',
  },
  {
    type: 'list',
    name: 'cloneOption',
    message: 'Do you want to clone the main branch or all branches?',
    choices: [
      { name: 'Only clone the main branch', value: false },
      { name: 'Clone all branches', value: true },
    ],
  },
]).then(answers => {
  const { repoUrl, parentFolderPath, repoFolderName, cloneOption } = answers;

  // Clone the repository into the parent folder (git-clone) and create branches in subfolders
  cloneRepository(repoUrl, parentFolderPath, repoFolderName, cloneOption);
});
