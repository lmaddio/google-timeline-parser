const express = require('express');
const cors = require('cors');
const { XMLParser } = require('fast-xml-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Initialize XML parser
const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_'
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

/**
 * Formats an E7 coordinate value to a float.
 * The first 2 digits remain as the integer part, the rest become decimal places.
 * Example: -545841325 becomes -54.5841325
 * 
 * @param {number} value - The E7 coordinate value
 * @returns {number|null} - The formatted float value, or null if invalid
 */
function formatE7ToFloat(value) {
    if (value === undefined || value === null) {
        return null;
    }

    // Convert to string to manipulate digits
    const strValue = String(value);
    
    // Check if negative
    const isNegative = strValue.startsWith('-');
    
    // Get the absolute digits (without negative sign)
    const digits = isNegative ? strValue.slice(1) : strValue;
    
    // Valid values must have at least 5 characters (not including negative sign)
    if (digits.length < 5) {
        return null;
    }
    
    // First 2 digits are the integer part, rest are decimal
    const integerPart = digits.slice(0, 2);
    const decimalPart = digits.slice(2);
    
    // Construct the float string and parse it
    const floatStr = `${isNegative ? '-' : ''}${integerPart}.${decimalPart}`;
    
    return parseFloat(floatStr);
}

/**
 * Fetches nominatim data from URL and parses XML response to JSON.
 * Extracts only city_district and country from the response.
 * Returns null if request or parsing fails.
 * 
 * @param {string} url - The nominatim URL to fetch
 * @returns {Promise<Object|null>} - Object with city_district and country, or null on error
 */
async function fetchNominatimData(url) {
    // Add timeout using AbortController (5 seconds)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    let response;
    let xmlText;
    
    // Step 1: Fetch the data
    try {
        response = await fetch(url, {
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            console.error(`[Nominatim Fetch] HTTP error for ${url}: ${response.status} ${response.statusText}`);
            return null;
        }
        
        xmlText = await response.text();
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            console.error(`[Nominatim Fetch] Request timeout for ${url}`);
        } else {
            console.error(`[Nominatim Fetch] Error fetching ${url}:`, error.message);
        }
        return null;
    }
    
    // Step 2: Parse and format the response
    try {
        const jsonData = xmlParser.parse(xmlText);
        
        // Extract only city_district and country from reversegeocode.addressparts
        const addressparts = jsonData?.reversegeocode?.addressparts;
        
        if (!addressparts) {
            console.error(`[Nominatim Parse] No addressparts found in response for ${url}`);
            return null;
        }
        
        return {
            city_district: addressparts.city_district || null,
            country: addressparts.country || null
        };
    } catch (error) {
        console.error(`[Nominatim Parse] Error parsing/formatting response for ${url}:`, error.message);
        return null;
    }
}

/**
 * Extracts all valid 'point' objects from the timelineEdits array.
 * Safely navigates the nested structure and filters out entries where any key is missing.
 * Formats latE7 and lngE7 values to float coordinates.
 * 
 * @param {Object} data - The input JSON data
 * @returns {Array} - Array of point objects with lat, lng, googleMaps and nominatimUrl
 */
function extractPoints(data) {
    const points = [];

    // Check if timelineEdits exists and is an array
    if (!data || !Array.isArray(data.timelineEdits)) {
        return points;
    }

    for (const edit of data.timelineEdits) {
        // Safely navigate through the nested structure
        // Check each level exists before accessing the next
        const rawSignal = edit?.rawSignal;
        if (!rawSignal) continue;

        const signal = rawSignal?.signal;
        if (!signal) continue;

        const position = signal?.position;
        if (!position) continue;

        const point = position?.point;
        if (!point) continue;

        // Validate that point has the required properties
        if (point.latE7 !== undefined && point.lngE7 !== undefined) {
            // Format the E7 values to floats
            const lat = formatE7ToFloat(point.latE7);
            const lng = formatE7ToFloat(point.lngE7);
            
            // Only include if both values are valid (at least 5 digits)
            if (lat !== null && lng !== null) {
                points.push({
                    lat: lat,
                    lng: lng,
                    googleMaps: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
                    nominatimUrl: `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}`
                });
            }
        }
    }

    return points;
}

/**
 * Enriches points with nominatim data by fetching all URLs in parallel.
 * Uses Promise.allSettled to handle individual failures gracefully.
 * 
 * @param {Array} points - Array of point objects with nominatimUrl
 * @returns {Promise<Array>} - Array of points with nominatimData added
 */
async function enrichPointsWithNominatimData(points) {
    // Fetch all nominatim data in parallel for maximum performance
    // Using Promise.allSettled so individual failures don't affect others
    const nominatimPromises = points.map(point => fetchNominatimData(point.nominatimUrl));
    const nominatimResults = await Promise.allSettled(nominatimPromises);
    
    // Add nominatimData to each point
    // Extract value from fulfilled promises, null from rejected ones
    return points.map((point, index) => {
        const result = nominatimResults[index];
        let nominatimData = null;
        
        if (result.status === 'fulfilled') {
            nominatimData = result.value;
        } else {
            console.error(`[Nominatim] Promise rejected for ${point.nominatimUrl}:`, result.reason?.message || result.reason);
        }
        
        return {
            ...point,
            nominatimData: nominatimData
        };
    });
}

/**
 * POST /parse-timeline
 * Receives a JSON body with timeline data and returns all point occurrences
 */
app.post('/parse-timeline', async (req, res) => {
    try {
        const data = req.body;

        if (!data || Object.keys(data).length === 0) {
            return res.status(400).json({
                error: 'Request body is empty or not valid JSON'
            });
        }

        const points = extractPoints(data);
        
        // Enrich points with nominatim data (parallel requests)
        const enrichedPoints = await enrichPointsWithNominatimData(points);

        return res.json({
            count: enrichedPoints.length,
            points: enrichedPoints
        });
    } catch (error) {
        console.error('Error processing request:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Start the server and keep reference to prevent garbage collection
const server = app.listen(PORT, HOST);

server.on('listening', () => {
    console.log(`Server is running on http://${HOST}:${PORT}`);
    console.log(`POST /parse-timeline - Parse timeline JSON and extract points`);
    console.log(`GET /health - Health check`);
});

server.on('error', (error) => {
    console.error('Server error:', error);
    process.exit(1);
});

// Keep the process alive
process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

module.exports = { app, server, extractPoints, formatE7ToFloat, fetchNominatimData, enrichPointsWithNominatimData };
