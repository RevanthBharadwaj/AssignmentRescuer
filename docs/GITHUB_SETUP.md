# Connecting this repository to GitHub

The repository was built locally and has no remote yet. These steps push it to any GitHub account, including one that is different from the account your computer normally uses.

## 1. Create the empty repository

On github.com, signed in to the account you want to use, create a new **private** repository (this project uses `RevanthBharadwaj/AssignmentRescuer`). Do not add a README, license or .gitignore (the project already has them).

## 2. Unpack the bundle

The project was delivered as a git bundle, which carries the full commit history.

```bash
git clone assignment-rescue-ai.bundle assignment-rescue-ai
cd assignment-rescue-ai
git remote remove origin   # the bundle file was set as origin by clone
```

## 3. Set the commit identity for this repository only

This does not change your global git settings, so work for other accounts is unaffected.

```bash
git config user.name "Your Name"
git config user.email "the-email-on-the-other-github-account@example.com"
```

## 4. Authenticate as the other account

Pick one.

Option A, GitHub CLI (simplest):

```bash
gh auth login              # choose GitHub.com, HTTPS, sign in as the other account
gh auth switch             # if you already have a different account logged in
gh auth setup-git
```

Option B, a separate SSH key:

```bash
ssh-keygen -t ed25519 -C "other-account" -f ~/.ssh/id_ed25519_other
# Add ~/.ssh/id_ed25519_other.pub at github.com → Settings → SSH and GPG keys (on the other account)
cat >> ~/.ssh/config <<'EOF'
Host github-other
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_other
  IdentitiesOnly yes
EOF
```

## 5. Add the remote and push

Option A (HTTPS):

```bash
git remote add origin https://github.com/OTHER_ACCOUNT/assignment-rescue-ai.git
git push -u origin main
```

Option B (SSH alias):

```bash
git remote add origin git@github-other:OTHER_ACCOUNT/assignment-rescue-ai.git
git push -u origin main
```

## 6. Confirm CI

Open the repository's Actions tab. The `CI` workflow runs type checks, lint, all tests and builds on Linux, macOS and Windows, builds installers on macOS and Windows, and runs the desktop end to end test on Linux. When it passes, macOS and Windows support counts as verified; until then, treat it as expected.

## Afterwards

Commits from future milestones should go to this remote. If Claude is continuing the work in a session connected to this GitHub account, it can push directly once the repository is attached to that session.
