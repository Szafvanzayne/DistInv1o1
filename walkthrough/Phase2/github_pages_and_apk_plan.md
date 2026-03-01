# Phase 2: GitHub Pages Deployment and APK Generation

## Goal Description
The user wants to host the Progressive Web App (PWA) securely online and subsequently generate an installable Android APK file. We will document these steps clearly in `Phase2` for future reference.

## Proposed Changes
We will proceed with the **GitHub Pages + PWABuilder** route as it's the industry standard for converting PWAs without managing complex local Android toolchains.

### 1. GitHub Pages Deployment
1. Navigate to the GitHub repository settings.
2. Under "Pages", set the source branch to `main` and the root directory.
3. Wait for the GitHub Action to build and deploy the site.
4. Retrieve the live `https://szafvanzayne.github.io/DistInv1o1/` URL.

### 2. APK Generation via PWABuilder
1. Once the site is live on GitHub Pages, we will use Microsoft's PWABuilder.
2. Input the live GitHub Pages URL into PWABuilder.
3. PWABuilder will automatically package the PWA into an Android App Bundle (`.aab`) and an installable APK.
4. Download the generated APK file.

## User Review Required
> [!IMPORTANT]
> The easiest way to get an APK is to have the site hosted online first. I recommend enabling GitHub Pages on your repository.
> 
> **To proceed, please do the following:**
> 1. Go to your repository on GitHub: `https://github.com/Szafvanzayne/DistInv1o1`
> 2. Click on **Settings** > **Pages** (on the left sidebar).
> 3. Under **Build and deployment** -> **Source**, select **Deploy from a branch**.
> 4. Under **Branch**, select `main` and `/ (root)`. Click **Save**.
> 
> Let me know once you've done this, and we can proceed to generate the APK using the live URL!

## Roadmap / To-Do
- [ ] **Data Security**: Secure the backend database structure so that stores can only read/write their own data, preventing unauthorized access or data leaks between different store accounts.
