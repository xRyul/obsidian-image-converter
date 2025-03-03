# Variables Reference Guide

This document provides a detailed explanation of all available variables for the file naming system. Each variable can be used in your templates to create dynamic and organized file names.

## Table of Contents

- [Basic File Information](#basic-file-information)
- [Date and Time Variables](#date-and-time-variables)
- [Image Properties](#image-properties)
- [Size Variables](#size-variables)
- [Hashing and Unique Identifiers](#hashing-and-unique-identifiers)
- [System Information](#system-information)
- [Examples and Use Cases](#examples-and-use-cases)

## Basic File Information

### File and Note Variables

- `{imageName}` - Original image filename without extension e.g.: For "vacation-photo.jpg" → "vacation-photo"
- `{noteName}` - Current note name e.g.: If editing "Travel Log.md" → "Travel Log"
- `{fileType}` - File extension e.g.: "jpg", "png", "pdf"
- `{parentFolder}` - Parent folder name e.g.: In "Documents/Photos/Vacation" → "Photos"
- `{parentparentfolder}` - Grandparent folder name e.g.: "Documents/Photos/Vacation" → "Documents"
- `{directory}` - Full directory path e.g.: "Documents/Photos/Vacation"
- `{folderName}` - Current folder name e.g.: In "Documents/Photos/Vacation" → "Vacation"
- `{depth}` - Number of subfolder levels e.g.: "Documents/Photos/Vacation" → "3"
- `{vaultName}` - Obsidian vault name e.g.: "My Knowledge Base"
- `{vaultPath}` - Full vault path e.g.: "C:/Users/username/Documents/Obsidian/My Knowledge Base"

## Date and Time Variables

### Basic Date Formats

- `{date:YYYY-MM-DD}` - Custom date format using moment.js patterns e.g.: "2024-10-31"
	- Supports all moment.js formats like:
		- `{date:YYYY}` → "2024"
		- `{date:MMMM Do YYYY}` → "October 31st 2024"
		- `{date:dddd}` → "Thursday"
		- `{date:HH:mm:ss}` → "14:30:45"

### Quick Date Variables

- `{today}` - Current date in YYYY-MM-DD format
- `{tomorrow}` - Tomorrow's date
- `{yesterday}` - Yesterday's date
- `{YYYY-MM-DD}` - Alternative current date format
- `{yyyy}` - Current year
- `{mm}` - Current month (01-12)
- `{dd}` - Current day (01-31)
- `{time}` - Current time in HH-mm-ss
- `{HH}` - Current hour (00-23)
- `{timestamp}` - Unix timestamp

### Natural Language Dates

- `{monthName}` or `{MMMM}` - Full month name e.: "October"
- `{dayName}` or `{dddd}` - Full day name e.g.: "Thursday"
- `{dateOrdinal}` or `{Do}` - Day with ordinal e.g.: "31st"
- `{relativeTime}` - Human-readable relative time. Examples:
	- "2 hours ago"
	- "in 3 days"
	- "a few seconds ago"
- `{calendar}` - moment.js calendar e.g.: "Today at 2:30 PM"

### Time Periods and Units

- `{startOfWeek}` - First day of current week
- `{endOfWeek}` - Last day of current week
- `{startOfMonth}` - First day of current month
- `{endOfMonth}` - Last day of current month
- `{nextWeek}` - Date next week
- `{lastWeek}` - Date last week
- `{nextMonth}` - Date next month
- `{lastMonth}` - Date last month
- `{daysInMonth}` - Number of days in current month
- `{weekOfYear}` or `{w}` - Week number (1-52)
- `{quarter}` or `{Q}` - Quarter (1-4)
- `{dayOfYear}` or `{DDD}` - Day of year (1-365)

## Image Properties

### Basic Dimensions

- `{width}` - Image width in pixels
- `{height}` - Image height in pixels
- `{ratio}` - Width/height ratio (2 decimals) e.g.: "1.78" for 16:9 ratio
- `{aspectRatio}` - More precise ratio (3 decimals)
- `{resolution}` - Full resolution string e.g.: "1920x1080"

### Size and Quality Indicators

- `{megapixels}` - Image megapixels e.g.: "2.07" for 1920x1080
- `{quality}` - Current conversion quality setting
- `{bytesPerPixel}` - Average bytes per pixel
- `{compressionRatio}` - Image compression ratio

### Image Analysis

- `{orientation}` - Image orientation: "landscape", "portrait", "square"
- `{isSquare}` - Square image indicator: "true", "false"
- `{aspectRatioType}` - Common aspect ratio name: "16:9", "4:3", "1:1", "16:10", "custom"
- `{sizeCategory}` - Image size category:
	- "tiny" (< 100K pixels)
	- "small" (< 500K pixels)
	- "medium" (< 2M pixels)
	- "large" (< 8M pixels)
	- "very-large" (≥ 8M pixels)
- `fileSizeCategory` - returns 1 of the 6 file size categories:
	- 0-50KB
	- 51-200KB
	- 201-1024KB
	- 1025KB-5MB
	- 5MB-10MB
	- 10MB+
- `{dominantDimension}` - Larger dimension: "width", "height", "equal"
- `{dimensionDifference}` - Pixel difference
- `{maxDimension}` - Larger dimension value
- `{minDimension}` - Smaller dimension value
- `{diagonalPixels}` - Diagonal resolution
- `{aspectRatioSimplified}` - Simplified ratio: "16:9" from 1920x1080
- `{screenFitCategory}` - Screen resolution category:
	- "fits-1080p" (≤ 1920x1080)
	- "fits-1440p" (≤ 2560x1440)
	- "fits-4k" (≤ 3840x2160)
	- "above-4k"

## Size Variables

### Flexible Size Formatting

- `{size:MB:2}` - Size in MB with custom decimals e.g.: "1.25 MB"
- `{size:KB:1}` - Size in KB with custom decimals e.g.: "1280.5 KB"
- `{size:B:0}` - Size in bytes with custom decimals e.g.: "1310720"

### Quick Size Variables

- `{sizeMB}` - Size in MB
- `{sizeKB}` - Size in KB
- `{sizeB}` - Size in bytes

## Hashing and Unique Identifiers

### MD5 Hashing Options

All MD5 hashes can be truncated using `:length` suffix
- `{MD5:filename}` - Hash of filename
- `{MD5:filename:8}` - First 8 characters of filename hash
- `{MD5:path}` - Hash of file path
- `{MD5:fullpath}` - Hash of complete path
- `{MD5:parentfolder}` - Hash of parent folder
- `{MD5:rootfolder}` - Hash of root folder
- `{MD5:extension}` - Hash of file extension
- `{MD5:notename}` - Hash of current note
- `{MD5:notefolder}` - Hash of note's folder
- `{MD5:notepath}` - Hash of note's path
- `{MD5:custom text}` - Hash of custom text

### Random Identifiers

- `{randomHex:6}` - Random hex string e.g.: "A1B2C3"
- `{counter:000}` - Incremental counter e.g.: "001", "002", "003"
- `{random}` - Random alphanumeric e.g.: "x7k9m2"
- `{uuid}` - Random UUID e.g.: "550e8400-e29b-41d4-a716-446655440000"

## System Information

- `{timezone}` - System timezone e.g.: "America/New_York" or "Europe/London"
- `{locale}` - System locale e.g.: "en-US"
- `{platform}` - Operating system e.g.:: "Win32", "MacIntel"
- `{userAgent}` - Browser user agent string

## Examples and Use Cases

1. Use forward slashes (/) to create subfolders
2. Combine different variable types for unique filenames
3. Include dates/minutes/seconds or any hashing algorithms to prevent duplication or replacement of files.

This allows us to create various organizational structures, and categorise various types of images based on folders, subfolders or pure file-naming. E.g.: Keep all images processed this week/month/quarter/year in 1 folder, or maybe even collect all images processed each day in their own respective folder. Not enough? We could further categorise them by project. Some of the possible use-cases: 

### Example 1 - Let Obsidian handle the folder creation

**Folder**: `Default`
**File naming**: `{noteName}-{date:YYYYMMDDHHmmSSsss}`

### Example 2 - 50/50 - Let Image Converter handle the images, and Obsidian all other attachments

In Image Converter:
- **Folder**: `/attachments/all-vault-images/{YYYY-MM-DD}/{noteName}/`
- **File naming**: `Inserted {imageName} at {YYYY-MM-DD} {time}`

In Obsidian: *Settings* -> *Files and links* -> *Default location for new attachments* -> *In the folder specified below:*
- Attachment folder path: : `/attachments`

This setup allows you to organize all images added to Obsidian in one main folder: `/all-vault-images` while keeping all other attachments (PDF, docx, zip etc.) in `/attachments` folder. 

```code
/attachments
├── all-vault-images
│   ├── 2024-10-31
│   │   ├── MyNoteName
│   │   │   ├── Inserted image1.jpg at 2024-10-31 12-34-56
│   │   │   └── Inserted image2.png at 2024-10-31 13-00-00
│   └── ... (other daily folders)
└── ... (other attachments, like PDFs, docs, etc.)
```

Inside  `/all-vault-images`, a new subfolder is automatically created for each day you add or process images, such as `/2024-10-31`. Each daily subfolder then contains subfolders for each note where images were inserted (e.g., `MyNoteName`). This is folder heavy approach, but the one which allows to easily create a chronological view of when which image was added into which note (because now all images from one specific note will be located under 1 same folder)

### Example 3 - Natural Language Date Organization - Journaling, Daily Logs etc.

- **Folder**: `/{yyyy}/{monthName}/Week {weekOfYear} ({startOfWeek} to {endOfWeek})/{dayName} {dateOrdinal}/`
- **File naming**: `{time}-{imageName}`

Example output is a path reads like natural language:

```
/2024/November/Week 45 (Oct 28 to Nov 3)/Thursday 31st/14-30-meeting-notes.jpg
/2024/November/Week 45 (Oct 28 to Nov 3)/Friday 1st/09-15-project-update.png
```

### Example 4 - keeping vault size small

- **Folder**: `/attachments/all-vault-images/{fileSizeCategory}/
- **File naming**: `{noteName}-{imageName}-{size:MB:2}MB_{date:YYYYMMDD}`

This would allow you to keep all images in 1 place categorised into subfolders based on converted image file size:

```
/attachments
├── all-vault-images
│   ├── 0-50KB
│   ├── 51-200KB
│   ├── 201-1024KB
│   ├── 1025KB-5MB
│   ├── 5MB-10MB
│   └── 10MB+
└── ... (other attachments, like PDFs, docs, etc.)
```

- 0-50KB - Files smaller than 50 kilobytes
- 51-200KB - Files between 51 and 200 kilobytes
- 201-1024KB - Files between 201 and 1024 kilobytes (1 megabyte)
- 1025KB-5MB - Files between 1025 kilobytes and 5 megabytes
- 5MB-10MB - Files between 5 and 10 megabytes
- 10MB+ - Files larger than 10 megabytes

For example, if I would see any images inside **1025KB-5MB**, **5MB-10MB**, **10MB+** folders, it would signify to me that those images require further optimization (or if I would like to keep my vault size small - I would even consider deleting them).

- `{noteName}` - if link is ever broken, embedding note name into actual image gives me enough context to track it down later, similarly with `{imageName}` and the `{date:YYYYMMDD}`
- `{size:MB:2}MB` - by adding size to the note, I can be proactive a see the size of the converted file, if it is too big I would re-process further with maybe higher compression level or maybe even a small resize
