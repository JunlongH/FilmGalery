# Map UI Optimization Plan

## 1. Overview
The current map interface uses basic markers and clusters that feel dated and lack visual polish. The goal is to modernize the map experience to match the quality of native photo gallery apps (like Apple Photos or Google Photos).

## 2. Current Issues (Based on Audit)
- **Cluster Layout:** The 2x2 grid is rigid. Clusters with 2 or 3 photos leave empty whitespace or look unbalanced.
- **Marker Styling:** The thick white borders and basic shadows feel heavy.
- **Badge Placement:** The red counter badge overlaps significant image content and lacks a refined look.
- **Map Interaction:** Transitions between single markers and clusters could be smoother.

## 3. Optimization Strategy

### A. Modern Marker Styling
We will adopt a **"Rounded Card"** aesthetic for single photos and a **"Dynamic Mosaic"** for clusters.

**Single Marker:**
- **Shape:** Rounded square (`border-radius: 12px`).
- **Border:** Thinner, cleaner white border (2px).
- **Shadow:** Soft, diffused shadow (`box-shadow: 0 4px 12px rgba(0,0,0,0.15)`) to lift the marker off the map.
- **Size:** Slightly larger (60px) for better visibility.

**Cluster Marker (Dynamic Mosaic):**
Instead of a fixed grid, the layout will adapt to the number of photos in the cluster:
1.  **1 Photo:** Shows as a Single Marker.
2.  **2 Photos:** Split vertically (Left/Right) or Horizontally (Top/Bottom).
3.  **3 Photos:** 
    - *Option A:* 1 Large (Left), 2 Small (Right Stacked).
    - *Option B:* 1 Large (Top), 2 Small (Bottom).
4.  **4+ Photos:** 2x2 Grid (Classic Mosaic).

### B. Refined Badges
- **Style:** Pill shape or small circle.
- **Position:** Floating at the top-right corner or center-bottom, slightly offsetting the border.
- **Color:** Use the app's primary color or a vibrant accent (e.g., system blue or orange) with a white text and border to ensure contrast.

### C. Map Layer
- Switch to a high-contrast, clean map tile (e.g., CartoDB Voyager or Positron) which is already in use, but ensure it complements the new marker style.

## 4. Implementation Plan

### Step 1: Update `leafletHtml.js` CSS
- Refine `.custom-marker` class.
- Create new CSS classes for dynamic layouts: `.mosaic-2`, `.mosaic-3`, `.mosaic-4`.

### Step 2: enhance `iconCreateFunction` in `leafletHtml.js`
- Rewrite the `iconCreateFunction` logic to detect the number of photos (1, 2, 3, 4+).
- Generate specific HTML structures for each case.
- Apply the corresponding CSS classes.

### Step 3: Polish Interactions
- Add a CSS `transition` to markers for hover/active states (scale up slightly when tapped).
- Ensure the `Spiderfy` animation (expanding clusters) aligns with the new visual style.

## 5. Mockup / Visual Reference
*(Description of intended result)*
- **2 Photos:** A square split down the middle with a thin white separator.
- **3 Photos:** A square with the left half being one photo, and the right half split into two smaller squares.
- **Shadows:** Deep, soft shadows that make markers feel like physical objects floating above the map.
