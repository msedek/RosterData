# Lost Ark Roster Scraper

A Node.js web scraper that extracts character roster data from Lost Ark and exports it to CSV format.

## Features

- Scrapes character roster data from uwuowo.mathi.moe
- Extracts character names, classes, item levels, and combat power
- Exports data to CSV format
- Supports multiple regions (NA, EU, etc.)
- Uses Playwright for reliable web scraping
- Express.js REST API for easy integration

## Installation

1. Clone the repository:
```bash
git clone https://github.com/msedek/RosterData.git
cd RosterData
```

2. Install dependencies:
```bash
npm install
```

3. Install Playwright browsers:
```bash
npx playwright install
```

## Usage

Start the server:
```bash
npm start
```

The server will start on `http://localhost:3000`

### API Endpoints

- `GET /:name/roster` - Get roster for a character (defaults to NA region)
- `GET /:region/:name/roster` - Get roster for a character in specific region
- `GET /:name/raw` - Get raw CSV data (for Google Sheets integration)
- `GET /:region/:name/raw` - Get raw CSV data for specific region
- `GET /health` - Health check endpoint

### Example Usage

```bash
# Get roster for character "PlayerName" in NA region
curl http://localhost:3000/PlayerName/roster

# Get roster for character "PlayerName" in EU region
curl http://localhost:3000/EU/PlayerName/roster

# Get raw CSV data for Google Sheets
curl http://localhost:3000/PlayerName/raw
```

## Configuration

The scraper includes performance tuning options in `server.js`:

- `STATS_CONCURRENCY`: Number of character pages to scrape in parallel (default: 3)
- `ROSTER_WAIT_MS`: Wait time on roster page (default: 400ms)
- `PROFILE_WAIT_MS`: Wait time on character profile pages (default: 350ms)

## Output Format

The CSV output includes the following columns:
- Name: Character name
- Class: Character class
- iLvl: Item level
- CombatPower: Combat power

## Dependencies

- Express.js - Web server framework
- Playwright - Web scraping and automation
- Node.js 16+ - Runtime environment

## License

ISC
