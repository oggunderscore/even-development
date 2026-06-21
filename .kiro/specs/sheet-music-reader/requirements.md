# Requirements Document

## Introduction

Sheet Music Reader is an Even Realities G2 AR glasses application that displays sheet music on a virtual music stand rendered in the glasses display. Musicians can import standard sheet music files, view notation rendered as a scrollable staff, and trigger auto-scrolling with a configurable count-ahead via a single tap on the glasses temple touchpad or R1 ring. The app leverages the G2's 576×288 4-bit greyscale display to render musical notation as image tiles that advance through the score.

## Glossary

- **Sheet_Music_Reader**: The Even G2 application that parses, renders, and scrolls sheet music on the glasses display
- **Score**: A complete sheet music document imported by the user, containing musical notation organized into measures
- **Staff**: The set of horizontal lines on which musical notes are placed; rendered as image content on the G2 display
- **Measure**: A segment of musical time defined by a time signature, containing notes and rests
- **Viewport**: The currently visible portion of the rendered score shown on the G2 display (576×288 px)
- **Auto_Scroll**: The automatic advancement of the viewport through the rendered score at a tempo-synchronized pace
- **Count_Ahead**: The configurable number of beats before the current playback position at which scrolling begins, allowing the musician to read ahead
- **Beat**: A single pulse within a measure as defined by the time signature of the score
- **Tempo**: The speed of the score expressed in beats per minute (BPM), extracted from the imported file or set manually
- **Companion_App**: The phone-side web interface used to configure settings and import files, rendered in the Even Hub WebView
- **Image_Tile**: A rendered segment of the score delivered to the glasses via the `updateImageRawData` SDK method (max 288×144 px)

## Requirements

### Requirement 1: Score Import

**User Story:** As a musician, I want to import sheet music files from standard formats, so that I can view my music on the AR glasses.

#### Acceptance Criteria

1. WHEN a MusicXML file is provided via the Companion_App, THE Sheet_Music_Reader SHALL parse the file into an internal Score representation containing at minimum: notes (pitch and duration), rests, and measure boundaries
2. WHEN a MIDI file is provided via the Companion_App, THE Sheet_Music_Reader SHALL parse the file into an internal Score representation containing at minimum: notes (pitch and duration), rests, and measure boundaries
3. WHEN an import file has a file extension other than .musicxml, .mxl, or .mid, THE Sheet_Music_Reader SHALL display an error message identifying the unsupported format on the Companion_App and reject the file
4. WHEN an import file contains invalid or malformed data, THE Sheet_Music_Reader SHALL display an error message on the Companion_App indicating the nature of the parsing failure and reject the file without modifying existing data
5. IF the imported file contains tempo information, THEN THE Sheet_Music_Reader SHALL extract the BPM value (within a range of 20 to 400 BPM) and store it in the internal Score representation
6. IF the imported file does not contain tempo information, THEN THE Sheet_Music_Reader SHALL assign a default tempo of 120 BPM to the internal Score representation
7. IF the imported file contains time signature information, THEN THE Sheet_Music_Reader SHALL extract and store the time signature in the internal Score representation
8. IF the imported file does not contain time signature information, THEN THE Sheet_Music_Reader SHALL assign a default time signature of 4/4 to the internal Score representation
9. IF the import file size exceeds 10 MB, THEN THE Sheet_Music_Reader SHALL reject the file and display an error message on the Companion_App indicating the file exceeds the maximum allowed size

### Requirement 2: Score Rendering

**User Story:** As a musician, I want to see my sheet music rendered clearly on the AR glasses, so that I can read the notation while playing.

#### Acceptance Criteria

1. THE Sheet_Music_Reader SHALL render the Score as a horizontal staff with notes, rests, and barlines within the 576×288 px display area
2. THE Sheet_Music_Reader SHALL render notation using 4-bit greyscale values compatible with the G2 display
3. THE Sheet_Music_Reader SHALL divide the rendered Score into Image_Tile segments no larger than 288×144 px each
4. THE Sheet_Music_Reader SHALL display the current Viewport position as the measure number in a text container
5. WHEN the Score contains multiple staves (e.g., treble and bass clef), THE Sheet_Music_Reader SHALL render both staves within the Viewport, allocating vertical space proportionally

### Requirement 3: Auto-Scroll Trigger

**User Story:** As a musician, I want to start auto-scrolling with a single tap, so that I can begin playing hands-free without interrupting my performance.

#### Acceptance Criteria

1. WHEN a single tap (CLICK_EVENT) is received from the glasses temple touchpad, THE Sheet_Music_Reader SHALL initiate the Auto_Scroll sequence within 300 milliseconds of the tap event
2. WHEN a single tap (CLICK_EVENT) is received from the R1 ring, THE Sheet_Music_Reader SHALL initiate the Auto_Scroll sequence within 300 milliseconds of the tap event
3. WHILE Auto_Scroll is active, WHEN a single tap is received from either the glasses temple touchpad or the R1 ring, THE Sheet_Music_Reader SHALL pause Auto_Scroll at the current Viewport position and display a visual indicator confirming the paused state
4. WHILE Auto_Scroll is paused, WHEN a single tap is received from either the glasses temple touchpad or the R1 ring, THE Sheet_Music_Reader SHALL resume Auto_Scroll from the current Viewport position and display a visual indicator confirming the scrolling state
5. WHEN a single tap is received, THE Sheet_Music_Reader SHALL wait at least 350 milliseconds before acting on the tap to distinguish it from the first tap of a double-tap gesture
6. IF a second tap is received within 350 milliseconds of a first tap, THEN THE Sheet_Music_Reader SHALL treat the input as a double-tap event and SHALL NOT trigger an Auto_Scroll state change

### Requirement 4: Count-Ahead Configuration

**User Story:** As a musician, I want to configure a count-ahead before scrolling begins, so that I have preparation time before the music advances.

#### Acceptance Criteria

1. THE Sheet_Music_Reader SHALL support configurable Count_Ahead values of 4 beats, 8 beats, and 12 beats, with a default value of 4 beats when no prior selection has been persisted
2. WHEN Auto_Scroll is initiated, THE Sheet_Music_Reader SHALL wait for the configured Count_Ahead duration, calculated as (Count_Ahead beats × 60 / Score Tempo in BPM) seconds, before advancing the Viewport
3. WHILE the Count_Ahead is active, THE Sheet_Music_Reader SHALL display the remaining beat count on the glasses display, decrementing the displayed value once per beat interval (60 / Score Tempo in BPM seconds)
4. THE Sheet_Music_Reader SHALL persist the selected Count_Ahead value between sessions using the bridge local storage
5. IF Auto_Scroll is initiated and no Score Tempo has been set, THEN THE Sheet_Music_Reader SHALL use the default tempo of 120 BPM for the Count_Ahead calculation

### Requirement 5: Tempo-Synchronized Scrolling

**User Story:** As a musician, I want the scroll speed to match the tempo of my music, so that the notation advances in time with my playing.

#### Acceptance Criteria

1. WHILE Auto_Scroll is active, THE Sheet_Music_Reader SHALL advance the Viewport at a rate synchronized to the Score Tempo in beats per minute, such that the scroll position deviates by no more than 100 milliseconds from the expected beat position
2. WHEN the Score Tempo is not available from the imported file (metadata field is missing or contains a non-numeric value), THE Sheet_Music_Reader SHALL use a default tempo of 120 BPM
3. WHEN the user submits a tempo override via the Companion_App with a value between 20 BPM and 400 BPM inclusive, THE Sheet_Music_Reader SHALL apply the override as the active Score Tempo within 500 milliseconds
4. WHILE Auto_Scroll is active, THE Sheet_Music_Reader SHALL advance the Viewport by one measure width per measure duration (derived from time signature and tempo)
5. IF the user submits a tempo override via the Companion_App with a value outside the range of 20 BPM to 400 BPM, THEN THE Sheet_Music_Reader SHALL reject the override, retain the current active tempo, and display an error message indicating the valid range
6. WHILE Auto_Scroll is active, WHEN the Score Tempo changes due to a user override or a tempo marking in the score, THE Sheet_Music_Reader SHALL transition to the new scroll rate within 1 second without interrupting the continuous scroll

### Requirement 6: Manual Navigation

**User Story:** As a musician, I want to manually scroll through the sheet music, so that I can review specific sections before or after playing.

#### Acceptance Criteria

1. WHILE Auto_Scroll is inactive, WHEN a swipe-down gesture is received, THE Sheet_Music_Reader SHALL advance the Viewport forward by one measure
2. WHILE Auto_Scroll is inactive, WHEN a swipe-up gesture is received, THE Sheet_Music_Reader SHALL move the Viewport backward by one measure
3. THE Sheet_Music_Reader SHALL apply a 300 ms debounce to scroll gesture events to prevent rapid uncontrolled advancement
4. WHILE Auto_Scroll is inactive, WHEN the Viewport is at the first measure and a swipe-up gesture is received, THE Sheet_Music_Reader SHALL remain at the first measure and not scroll further backward
5. WHILE Auto_Scroll is inactive, WHEN the Viewport is at the last measure and a swipe-down gesture is received, THE Sheet_Music_Reader SHALL remain at the last measure and not scroll further forward

### Requirement 7: Display Layout

**User Story:** As a musician, I want the music notation to use the full glasses display effectively, so that I can read the notes at a comfortable size.

#### Acceptance Criteria

1. THE Sheet_Music_Reader SHALL use a layout with exactly 2 containers: one image container (containerID 1, position 0,0, width 288, height 144) for score rendering and one text container (containerID 2, position 0,144, width 576, height 144) for status information
2. THE Sheet_Music_Reader SHALL set exactly one container with `isEventCapture: 1` to receive input events
3. THE Sheet_Music_Reader SHALL call `createStartUpPageContainer` exactly once at startup and use `textContainerUpgrade` and `updateImageRawData` for all subsequent display updates
4. IF the initial page container creation returns a non-zero result code, THEN THE Sheet_Music_Reader SHALL log the error and display a failure message on the Companion_App
5. IF `updateImageRawData` returns a result other than `success`, THEN THE Sheet_Music_Reader SHALL display an error indication in the text container describing the failure reason

### Requirement 8: Application Lifecycle

**User Story:** As a musician, I want the app to handle start, exit, and interruptions gracefully, so that it behaves reliably on the glasses.

#### Acceptance Criteria

1. WHEN a double-tap event is received, THE Sheet_Music_Reader SHALL stop Auto_Scroll, unsubscribe from all event listeners, and call `shutDownPageContainer` to exit in that order
2. WHEN a SYSTEM_EXIT_EVENT or ABNORMAL_EXIT_EVENT is received, THE Sheet_Music_Reader SHALL stop Auto_Scroll and unsubscribe from all event listeners
3. WHEN the `beforeunload` window event fires, THE Sheet_Music_Reader SHALL unsubscribe from all bridge event listeners
4. WHEN the application starts, THE Sheet_Music_Reader SHALL call `createStartUpPageContainer`, subscribe to required events, and render the initial Viewport within 5 seconds
5. WHEN a FOREGROUND_EXIT_EVENT is received, THE Sheet_Music_Reader SHALL pause Auto_Scroll if active
6. WHEN a FOREGROUND_ENTER_EVENT is received after a prior FOREGROUND_EXIT_EVENT, THE Sheet_Music_Reader SHALL restore the display state and remain paused (not auto-resume scrolling)

### Requirement 9: Score Library

**User Story:** As a musician, I want to keep a library of imported scores, so that I can quickly switch between pieces without re-importing.

#### Acceptance Criteria

1. WHEN a Score is successfully imported, THE Sheet_Music_Reader SHALL store the parsed Score data in local storage via the bridge, keyed by a unique identifier, along with the Score title and import timestamp
2. THE Companion_App SHALL display a list of previously imported Scores showing the Score title and import date for each entry
3. WHEN a Score is selected from the library, THE Sheet_Music_Reader SHALL load the Score data from local storage, parse it, and render the first Viewport within 3 seconds
4. WHEN a Score is deleted from the library via the Companion_App, THE Sheet_Music_Reader SHALL remove the Score data from local storage and update the displayed library list
5. IF storing a Score to local storage fails, THEN THE Sheet_Music_Reader SHALL display an error message on the Companion_App indicating the Score could not be saved and SHALL NOT add the Score to the library list
6. IF a stored Score cannot be loaded or parsed when selected, THEN THE Sheet_Music_Reader SHALL display an error message on the Companion_App indicating the Score is corrupted and SHALL offer to remove it from the library
7. THE Sheet_Music_Reader SHALL support a library of up to 50 stored Scores
