# ScoutIQ

Colorado scouting platform prototype. Static HTML/CSS/JS today, planned migration to React.

## What's here

- `index.html` — Scout Tool and Plan Your Hunt UI
- `style.css` — full stylesheet
- `app.js` — full engine: Leaflet + esri-leaflet map, CPW GMU boundaries, land/water/wildlife/trail layers, terrain analysis (slope, aspect, TPI, curvature, ScoutIQ score), saved pins, and the Plan Your Hunt draw odds dashboard from CPW 2025 elk draw data

## Run locally

Open `index.html` in a browser, or serve it:

    npx serve .

## Status

Working prototype. Layers activate once a unit is selected. Draw odds cover the 2025 Primary Elk Draw Recap (one year, so trend arrows stay flat). React migration planned.
