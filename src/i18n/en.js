const en = {
  translation: {
    // Nav
    signOut: 'Sign out',
    offline: 'OFFLINE',
    queued:  'QUEUED',
    roleLabel: {
      citizen:    'Citizen',
      ngo:        'NGO Responder',
      government: 'Government',
    },
    toggleLang: 'தமிழ் | English',

    // Login
    signIn:       'Sign in',
    signInSub:    'Access your AidPulse dashboard.',
    emailAddress: 'Email address',
    password:     'Password',
    signingIn:    'Signing in…',
    noAccount:    'No account?',
    registerHere: 'Register here',

    // Register
    createAccount:    'Create account',
    createAccountSub: 'Citizen only. NGO accounts are created by Government.',
    fullName:         'Full name',
    phone:            'Mobile number (+91, optional)',
    phonePlaceholder: '10-digit number, starts 6–9',
    passwordMin:      'Password (min. 6 characters)',
    creatingAccount:  'Creating account…',
    alreadyRegistered: 'Already registered?',
    signInLink:       'Sign in',
    consentLabel:     'I agree that AidPulse may collect my location and contact details to coordinate disaster relief.',
    consentRequired:  'You must agree to continue.',

    // Citizen
    needTypes: {
      rescue:  'Rescue',
      medical: 'Medical',
      food:    'Food',
      shelter: 'Shelter',
    },
    sendReport:   'Send report',
    saveOffline:  'Save (offline)',
    sending:      'Sending…',
    selectNeeds:  'Select at least one need',
    reportSent:   'Report sent.',
    reportSaved:  'Saved — will send when signal returns.',
    useMyLocation: 'Use my location',
    tapToPlace:   'Tap the map to place your pin.',

    // GPS
    geoPermissionDenied: 'Location access denied. Go to Site settings → Location → Allow.',
    geoUnavailable: 'Your device cannot find its location. Turn on Location in device settings.',
    geoTimeout:     'Location timed out. Tap "Use my location" to retry or place pin manually.',
    geoAccuracy:    '±{{accuracy}} m accuracy',
    geoApprox:      'Accuracy over 100 m — move to open sky or drag the pin to refine.',

    // My reports
    myReports:      'My Reports',
    noReportsYet:   'No reports yet.',
    noReportsSub:   'Your submitted reports will appear here with live need-by-need tracking.',

    // Status labels
    status: {
      sent:        'Sent',
      pending:     'Pending',
      claimed:     'Claimed',
      on_the_way:  'On the way',
      in_progress: 'In progress',
      resolved:    'Resolved',
    },

    // NGO
    pendingNeeds:     'Pending needs',
    noPendingNeeds:   'No pending requests.',
    noPendingNeedsSub: 'Incoming reports matching your capabilities will appear here.',
    claim:        'Claim',
    claiming:     'Claiming…',
    alreadyClaimed:   'Already claimed by another responder.',
    claimRecorded:    'Claimed.',
    inProgress:   'In progress',
    markResolved: 'Mark resolved',
    release:      'Release',

    // Government
    liveMap:     'Live map',
    coverageGaps: 'Coverage gaps',
    clusters:    'Clusters',
    ngos:        'NGOs',
    createNgo:   '+ Create NGO',
    ngoCreated:  'NGO account created.',
    suspend:     'Suspend',
    restore:     'Restore',
    forceRelease: 'Force release',
    suspended:   'Suspended',
    active:      'Active',

    // Footer
    footer: 'Emergency 112 · Ambulance 108 · Disaster helpline 1070 · District control room 1077',
  },
}

export default en
