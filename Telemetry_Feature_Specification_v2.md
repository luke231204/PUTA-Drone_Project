# Feature Specification: Automated Drone Telemetry CSV to Speed Graph Converter

This document outlines the core architecture, data extraction requirements, and implementation steps for adding an automated telemetry charting engine into our application. This module will allow users to upload raw drone log CSV files (such as Airdata telemetry exports) and instantly generate high-resolution speed and altitude profiles for structural incident and civil aviation compliance reporting.

---

## 1. Feature Overview
Drone audit reporting requires cross-referencing flight velocity profiles with airspace boundaries (such as airport approach corridors or active NOTAM restrictions). Manually extracting columns and parsing millisecond timelines in standalone spreadsheet software slows down the inspection pipeline.

The **CSV to Speed Graph Converter** module automates this by:
1. Parsing fine-grained drone telemetry files natively inside the application interface.
2. Filtering out system calibration/pre-flight stationary points.
3. Rendering an interactive or exportable dual-axis visualization mapping velocity ($	ext{mph}$ or $	ext{knots}$) and vertical profiles ($	ext{ft AMSL/AGL}$) against a synchronized time scale.

---

## 2. Core Technical Specifications

### Data Input Formats
* **Source:** Standard comma-delimited text (`.csv`).
* **Primary Headers Required:**
  * `time(millisecond)`: Elapsed runtime of flight processor.
  * `speed(mph)` or `speed(m/s)`: Linear velocity tracking.
  * `altitude_above_seaLevel(feet)` or `height_above_takeoff(feet)`: Absolute/relative height vectors.

### Analytical Data Operations
To ensure the generated graph displays actionable data without cluttering the user interface, the parsing algorithm must carry out two specific operational pipelines:

#### A. Temporal Timeline Smoothing
Raw telemetry logs register updates at sub-second intervals (typically every $100	ext{ms}$ to $250	ext{ms}$). To avoid a jagged, unreadable visualization, the interface must process the x-axis time metrics as follows:
$$t_{	ext{minutes}} = rac{t_{	ext{millisecond}}}{60,000}$$

#### B. Flight Threshold Filtering
Drones log system parameters while resting on the landing pad prior to receiving a GPS satellite lock. The parsing engine should flag data rows where:
$$	ext{speed(mph)} = 0 \quad 	ext{AND} \quad 	ext{height\_above\_takeoff(feet)} \le 0$$
These points should either be omitted or visually marked as a "Pre-Flight Ground Phase" on the rendering canvas.

---

## 3. Reference Implementation Architecture

The following reference implementation demonstrates how to build the backend parser using standard Python web and data processing libraries (`pandas` and `matplotlib`). This architecture can easily be ported to JavaScript (Node.js/D3.js) or cross-platform application frameworks depending on your target application ecosystem.

```python
import pandas as pd
import matplotlib.pyplot as plt

def generate_telemetry_profile(csv_path, output_image_path):
    # 1. Ingest raw drone telemetry log
    df = pd.read_csv(csv_path)
    
    # 2. Smooth timeline from milliseconds to decimal minutes
    df['time_minutes'] = df['time(millisecond)'] / 60000.0
    
    # 3. Initialize dual-axis charting canvas
    fig, ax1 = plt.subplots(figsize=(11, 5.5))
    
    # Configure Left Axis: Altitude Profile
    color_alt = '#1f77b4' # Slate Blue
    ax1.set_xlabel('Elapsed Time (minutes)', fontsize=11, fontweight='bold', labelpad=10)
    ax1.set_ylabel('Altitude (feet, AMSL)', color=color_alt, fontsize=11, fontweight='bold')
    ax1.plot(df['time_minutes'], df['altitude_above_seaLevel(feet)'], color=color_alt, linewidth=2, label='Altitude')
    ax1.tick_params(axis='y', labelcolor=color_alt)
    ax1.grid(True, linestyle='--', alpha=0.4)
    
    # Configure Right Axis: Velocity Profile
    ax2 = ax1.twinx()  
    color_speed = '#ff7f0e' # Desaturated Orange
    ax2.set_ylabel('Ground Speed (mph)', color=color_speed, fontsize=11, fontweight='bold')
    ax2.plot(df['time_minutes'], df['speed(mph)'], color=color_speed, linewidth=1.5, alpha=0.8, label='Speed')
    ax2.tick_params(axis='y', labelcolor=color_speed)
    
    # Formatting adjustments for official report exports
    plt.title('Drone Flight Telemetry Profile (Altitude & Speed Analysis)', fontsize=13, fontweight='bold', pad=15)
    fig.tight_layout()
    
    # 4. Save file to asset folder for reporting pipeline
    plt.savefig(output_image_path, dpi=300)
    plt.close()

# Example usage trigger within the app backend:
# generate_telemetry_profile('flight_log.csv', 'report_asset_graph.png')
```

---

## 4. UI/UX Workflow Requirements

To integrate this cleanly as a core application menu feature, design the user experience around a 3-step action sequence:

```
[ User Menu ] ──> [ Drag-and-Drop CSV ] ──> [ Dynamic Rendering Canvas ] ──> [ Export Report Image ]
```

1. **Upload Target:** Implement a designated drag-and-drop landing container supporting standard file input restrictions (`accept=".csv"`).
2. **Dynamic Canvas Renders:** Use a canvas engine (like Chart.js or D3) to display the parsed array coordinates interactively. Users should be able to hover over a specific timeline node to cross-examine specific points (e.g., pinpointing the coordinates where an overspeed anomaly occurred).
3. **One-Click Export:** Include a dedicated function button enabling instant snapshot extraction of the current view as a high-density image asset (`.png`) formatted to seamlessly drop into formal engineering or civil aviation audit documents.
