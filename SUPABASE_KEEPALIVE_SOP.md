# SOP: Supabase Project Keep-Alive System

This document outlines the Standard Operating Procedure (SOP) to bypass Supabase's automatic pause regulation on the free tier. This system generates automated, minimal read requests to your database to keep it marked as "active" even when your Electron application is closed.

---

## 1. System Components
1. **`supabase_keepalive.py`**: A lightweight, standalone Python script that performs a minimal `GET` request on your `permits` table. It has no external dependencies and uses Python's standard `urllib` library.
2. **GitHub Actions Workflow (`.github/workflows/supabase_keepalive.yml`)**: Automates the execution of the keep-alive script in the cloud every 3 days.

---

## 2. Option A: Cloud Automation (Recommended & Zero Maintenance)
This approach runs entirely on GitHub's servers. You don't need to keep your computer turned on, and you don't need to open the app.

### Step-by-Step Setup:
1. **Push the files to GitHub**: Ensure `supabase_keepalive.py` and `.github/workflows/supabase_keepalive.yml` are pushed to your remote repository.
2. **Add Repository Secrets**:
   - Go to your repository on GitHub.
   - Navigate to **Settings** > **Secrets and variables** > **Actions**.
   - Click **New repository secret** and add the following two secrets:
     * **Name**: `SUPABASE_URL`  
       **Value**: `https://fmporacvrfwtipujohxl.supabase.co`
     * **Name**: `SUPABASE_SERVICE_ROLE_KEY`  
       **Value**: *(Your service role key from `data/Cred.env`)*
3. **Execution**:
   - GitHub will run this script automatically every 3 days.
   - You can also manually trigger it by going to the **Actions** tab on GitHub, selecting **Supabase Keep-Alive**, and clicking **Run workflow**.

---

## 3. Option B: Local Automation (Windows Task Scheduler)
If you prefer not to use GitHub, you can configure Windows to run the keep-alive script in the background automatically when your computer starts or on a daily basis.

### Step-by-Step Setup:
1. Press `Win + R`, type `taskschd.msc`, and press **Enter** to open the **Windows Task Scheduler**.
2. Click **Create Basic Task...** in the Actions pane on the right.
3. **Name**: `Supabase KeepAlive`
4. **Trigger**: Select **Daily** or **When I log on**.
5. **Action**: Select **Start a program**.
6. **Program/script**: Enter `pythonw` (using `pythonw` instead of `python` runs the script silently in the background without displaying a command prompt window).
7. **Add arguments**: `supabase_keepalive.py`
8. **Start in (optional)**: Enter the absolute path to your project folder:  
   `C:\Users\lukma\Downloads\Project Latsar PUTA`
9. Click **Finish**.

---

## 4. Verification
To verify that the keep-alive mechanism is working:
* Run the script manually in your terminal to see the response:
  ```bash
  python supabase_keepalive.py
  ```
* On success, you should see:
  ```text
  Loading environment variables from: ...\data\Cred.env
  Sending keep-alive request to: https://fmporacvrfwtipujohxl.supabase.co/rest/v1/permits?select=permit_id&limit=1...
  SUCCESS: Supabase keep-alive successful. Status: 200
  ```
