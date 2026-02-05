# google-timeline-parser

A Node.js Express backend that parses Google Timeline JSON data and extracts location points.

## Installation

```bash
npm install
```

## Usage

Start the server:

```bash
npm start
```

The server will run on `http://localhost:3000` by default. You can change the port by setting the `PORT` environment variable.

## API Endpoints

### POST /parse-timeline

Parses Google Timeline JSON data and extracts all location points.

**Request Body:**

The endpoint accepts JSON with the following structure:

```json
{
  "timelineEdits": [
    {
      "rawSignal": {
        "signal": {
          "position": {
            "point": {
              "latE7": -255982063,
              "lngE7": -545841325
            }
          }
        }
      }
    }
  ]
}
```

**Note:** All nested keys (`timelineEdits`, `rawSignal`, `signal`, `position`, `point`) are optional. The endpoint will safely navigate the structure and filter out any objects where keys are missing.

**Response:**

```json
{
  "count": 2,
  "points": [
    { "latE7": -255982063, "lngE7": -545841325 },
    { "latE7": -255981480, "lngE7": -545841248 }
  ]
}
```

**Example:**

```bash
curl -X POST http://localhost:3000/parse-timeline \
  -H "Content-Type: application/json" \
  -d @mock_data.json
```

### GET /health

Health check endpoint.

**Response:**

```json
{
  "status": "ok"
}
```

## Testing with Mock Data

You can test the API using the included `mock_data.json` file:

```bash
curl -X POST http://localhost:3000/parse-timeline \
  -H "Content-Type: application/json" \
  -d @mock_data.json
```

## License

ISC
