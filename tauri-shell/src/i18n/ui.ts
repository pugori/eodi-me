export type UiLocale = 'en' | 'ko' | 'ja' | 'zh' | 'es' | 'fr' | 'de' | 'pt';

export interface UiCopy {
  searchPlaceholder: string;
  searchAria: string;
  searchButton: string;
  searchingButton: string;
  clearSearchAria: string;
  clearSearchTitle: string;
  resultCountAria: (n: number) => string;
  helperExample: string;
  helperMinChars: (n: number) => string;
  nextStepHint: string;
  recentSearches: string;
  clear: string;
  suggestions: string;
  searchResults: string;
  browseResults: string;
  searchResultsCount: (n: number) => string;
  resultsKeyboardHint: string;
  matchLabel: string;
  searchingLocations: string;
  typeMinChars: (n: number) => string;
  noNeighborhoodFound: (q: string) => string;
  statusSearch: string;
  statusBrowse: string;
  statusHexes: (n: number) => string;
  suggestedSearches: string;
  errorTitle: string;
  errorDismiss: string;
  networkError: string;
  splashAria: string;
  splashCityVibeEngine: string;
  splashConnecting: string;
  splashLoadingDb: string;
  splashReady: string;
  retry: string;
  settingsAndAbout: string;
  systemInformation: string;
  appVersion: string;
  engineSpec: string;
  databaseStats: string;
  builtAt: string;
  unknown: string;
  hexagons: string;
  cities: string;
  dataManagement: string;
  resetUserData: string;
  resetUserDataDesc: string;
  clearAllLocalData: string;
  resetConfirm: string;
  support: string;
  privacy: string;
  terms: string;
  vibeReportTitle: string;
  closeVibeReport: string;
  matchWord: string;
  confidenceWord: string;
  analyzedVibe: string;
  vibeMatch: string;
  vibeSearchHint: string;
  selectedVibe: string;
  noData: string;
  selectAnotherHexToCompare: string;
  perCategories: string;
  vibeDifference: string;
  perComparison: string;
  trendActivity: string;
  population: string;
  topVibe: string;
  secondVibe: string;
  vectorDistance: string;
  cityId: string;
  clearCompare: string;
  compareVibes: string;
  standoutReport: string;
  share: string;
  saved: string;
  save: string;
  copiedToClipboard: string;
  vibeProfileLabel: string;
  compareDeltaHint: string;
  analysisPanelAria: string;
  analysisRailAria: string;
  analysisRailTitle: string;
  analysisTitle: string;
  collapsePanelAria: string;
  modeSuitability: string;
  modeCompare: string;
  modeExplore: string;
  suitabilityCriteria: string;
  reset: string;
  resetWeightsAria: string;
  analysisPresets: string;
  presetNamePlaceholder: string;
  saveCurrentAsPreset: string;
  display: string;
  colorLegend: string;
  mapLabels: string;
  savedLocations: string;
  emptyBookmarksHint: string;
  editNoteAria: string;
  editNoteTitle: string;
  removeBookmarkAria: (name: string) => string;
  addNotePlaceholder: string;
  statistics: string;
  hexagonsVisible: string;
  totalInView: string;
  modeLabel: string;
  activeWeights: string;
  totalHexagons: string;
  engineModeLabel: string;
  sigmaLabel: string;
  weightDistribution: string;
  userDataOnlyReadonlyDb: string;
  openSettingsAria: string;
  saveLocationAria: string;
  removeBookmarkActionAria: string;
  saveToBookmarksTitle: string;
  removeBookmarkTitle: string;
  savedToBookmarks: string;
  removedFromBookmarks: string;
  locationCompare: string;
  filterCountry: string;
  filterCity: string;
  filterNeighborhood: string;
  filterPlaceholderCountry: string;
  filterPlaceholderCity: string;
  filterPlaceholderNeighborhood: string;
  filteredHexes: (n: number) => string;
  baseHex: string;
  top3SimilarHexes: string;
  noFilteredHexes: string;
  noTop3Match: string;
  compareWithThis: string;
  selectAsBase: string;
  b2bPoiInput: string;
  selectedHexAutoFill: string;
  h3Index: string;
  poiSingleInput: string;
  poiBulkInput: string;
  importFile: string;
  applySingle: string;
  applyBulk: string;
  bulkFormatHint: string;
  bulkResultApplied: (n: number) => string;
  bulkResultPartial: (ok: number, fail: number) => string;
  overlayApplyFailed: string;
  selectCountry: string;
  selectCity: string;
  selectNeighborhood: string;
  allCountries: string;
  allCities: string;
  allNeighborhoods: string;
  premiumOnly: string;
  premiumPoiHint: string;
  upgradeNow: string;
  premiumFeature: string;
  // Free tier truncation
  freeTierNotice: string;
  freeTierUpgradeHint: string;
  upgrade: string;
  // Settings modal
  subscriptionLabel: string;
  renewsExpires: string;
  manageLabel: string;
  freePlanDesc: string;
  personalPlanDesc: string;
  soloBizPlanDesc: string;
  businessPlanDesc: string;
  enterprisePlanDesc: string;
  // License activation modal
  choosePlan: string;
  currentPlanLabel: string;
  renewsLabel: string;
  mostPopularLabel: string;
  activeLabel: string;
  orYearly: string;
  deactivateTitle: string;
  deactivateDesc: string;
  yesDeactivate: string;
  deactivatingLabel: string;
  cancelLabel: string;
  deactivateLabel: string;
  upgradeLabel: string;
  switchLabel: string;
  hideLicenseKey: string;
  showLicenseKey: string;
  activatingLabel: string;
  activateLicenseBtn: string;
  licenseKeyEmailHint: string;
  activatedSuccess: string;
  deactivatedSuccess: string;
  // Map legend
  tryDifferentSearch: string;
  dominantVibe: string;
  similarityScore: string;
  suitabilityScore: string;
  opacityDataIntensity: string;
  low: string;
  high: string;
  // Compare picker banner
  selectLocationToCompare: string;
  loadingNeighborhoodData: string;
  // VibeReport lock gate
  fullVibeReport: string;
  vibeReportUpgradeHint: string;
  upgradeToPersonal: string;
  cancelPickingCompare: string;
  // Search result match reasons
  matchReasonLocation: string;
  matchReasonNeighborhood: string;
  // Feature gate messages
  proFeatureRequired: string;
  personalMatchHint: string;
  // Onboarding
  onboardingTitle: string;
  onboardingStep1Title: string;
  onboardingStep1Desc: string;
  onboardingStep2Title: string;
  onboardingStep2Desc: string;
  onboardingStep3Title: string;
  onboardingStep3Desc: string;
  onboardingNext: string;
  onboardingDone: string;
  onboardingSkip: string;
  // Connection recovery
  engineOffline: string;
  engineReconnecting: string;
  engineReconnected: string;
  // Map empty state
  mapEmptyHint: string;
  mapEmptySubhint: string;
  // FAQ
  faqTitle: string;
  faq1q: string;
  faq1a: string;
  faq2q: string;
  faq2a: string;
  faq3q: string;
  faq3a: string;
  faq4q: string;
  faq4a: string;
  faq5q: string;
  faq5a: string;
  faq6q: string;
  faq6a: string;
  // App updater
  updateAvailable: string;
  updateVersion: (v: string) => string;
  updateInstall: string;
  updateDismiss: string;
  updateInstalling: string;
  // Splash error diagnosis
  splashDiagCopy: string;
  splashDiagCopied: string;
  splashDiagTitle: string;
  splashDiagPossibleCause: string;
  splashDiagSteps: string;
  // Settings copy diagnostic
  copyDiagnosticBtn: string;
  copyDiagnosticDone: string;
  // Export
  exportCsvBtn: string;
  exportAnalysisBtn: string;
  exportedRows: (n: number) => string;
  // Print
  printReportBtn: string;
  // Comparison table
  compareThisLocation: string;
  compareOtherLocation: string;
  // FAQ 7-9 (self-service CS)
  faq7q: string;
  faq7a: string;
  faq8q: string;
  faq8a: string;
  faq9q: string;
  faq9a: string;
  // Feature gate tips (presets, export)
  presetsGateTitle: string;
  presetsGateTip: string;
  noPresetsYet: string;
  exportGateTip: string;
  // What's New modal
  whatsNewTitle: string;
  whatsNewTagline: string;
  whatsNewClose: string;
  whatsNewDontShow: string;
  whatsNewFreeLabel: string;
  whatsNewPersonalLabel: string;
  whatsNewSoloBizLabel: string;
  whatsNewFreeLine1: string;
  whatsNewFreeLine2: string;
  whatsNewPersonalLine1: string;
  whatsNewPersonalLine2: string;
  whatsNewSoloBizLine1: string;
  // Local API section
  localApiTitle: string;
  localApiDesc: string;
  localApiEndpoint: string;
  localApiSessionToken: string;
  localApiPersistentKey: string;
  localApiKeyNote: string;
  localApiRegenerate: string;
  localApiRegenerateConfirm: string;
  localApiCopied: string;
  localApiShow: string;
  localApiHide: string;
  localApiUpgradeHint: string;
  localApiDocsTitle: string;
  localApiRestartNote: string;
  // Billing cycle toggle
  billingMonthly: string;
  billingAnnual: string;
  billingSaveLabel: (pct: number) => string;
  billingAnnualNote: string;
  // Error toast messages
  errorNetwork: string;
  errorEngine: string;
  errorTimeout: string;
  errorProRequired: string;
  errorAuth: string;
  errorServer: string;
  errorNotFound: string;
  // Navigation
  backToResults: string;
  // Engine state
  engineNotRunning: string;
  engineFailedToStart: string;
  // Tooltip
  tooltipSuitability: string;
  tooltipMatch: string;
  tooltipUnknown: string;
  // Diagnostic report (clipboard)
  diagnosticReportTitle: string;
  // Copy Python example button
  copyPythonExample: string;
  // Billing per-month suffix
  billingPerMonth: string;
  // Onboarding progress aria
  onboardingStepProgress: (step: number, total: number) => string;
  // Empty-state search hint
  emptyStateSearchHint: string;
  // Browse guide (low zoom)
  browseGuideTitle: string;
  browseGuideSubtitle: string;
  browseGuideStep1: string;
  browseGuideStep2: string;
  browseGuideStep3: string;
  // Search result toast
  searchResultToast: (n: number) => string;
  // Bookmark feedback toasts
  bookmarkAdded: string;
  bookmarkRemoved: string;
  // Compare guide (analysis panel - comparison mode)
  compareGuideTitle: string;
  compareGuideBody: string;
  compareGuideStep1: string;
  compareGuideStep2: string;
  compareGuideStep3: string;
  // File import error
  fileImportError: string;
  // API regen failure
  regenFailed: string;
  // Compare overlay
  findCompareTarget: string;
  matchingAreas: string;
  // Stats dashboard
  statsHexCount: string;
  statsAvgScore: string;
  statsDominantVibe: string;
  // Legend toggle
  showLegend: string;
  hideLegend: string;
  // Analysis histogram
  scoreDistribution: string;
  zoneCount: (n: number) => string;
  suitabilityScaleNone: string;
  suitabilityScaleLow: string;
  suitabilityScaleMedium: string;
  suitabilityScaleHigh: string;
  suitabilityScaleBest: string;
  swapComparison: string;
  // Help / keyboard shortcuts modal
  helpTitle: string;
  openHelpAria: string;
  shortcutsSection: string;
  quickTipsSection: string;
  shortcutFocusSearch: string;
  shortcutNavigate: string;
  shortcutSelect: string;
  shortcutClose: string;
  shortcutHelp: string;
  shortcutCollapse: string;
  tipClickHex: string;
  tipAnalysis: string;
  tipCompare: string;
  tipSettings: string;
  // Address → H3 geocoding in POI overlay
  addressSearchPlaceholder: string;
  addressSearchBtn: string;
  addressSearching: string;
  addressFound: (name: string) => string;
  addressNotFound: string;
  addressSearchHint: string;
}

const EN: UiCopy = {
  searchPlaceholder: 'Search neighborhood / area (e.g. Shibuya, Brooklyn)',
  searchAria: 'Search for neighborhoods',
  searchButton: 'Search',
  searchingButton: 'Searching…',
  clearSearchAria: 'Clear search',
  clearSearchTitle: 'Clear',
  resultCountAria: (n) => `${n} results`,
  helperExample: 'e.g. Shibuya, Brooklyn, Le Marais',
  helperMinChars: (n) => `Press Enter • min ${n} chars`,
  nextStepHint: 'Type an area, press Enter, then choose one result on the map.',
  recentSearches: 'Recent Searches',
  clear: 'Clear',
  suggestions: 'Suggestions',
  searchResults: 'Search Results',
  browseResults: 'Nearby Areas',
  searchResultsCount: (n) => `${n} places`,
  resultsKeyboardHint: '↑/↓ to move • Enter to select',
  matchLabel: 'match',
  searchingLocations: 'Searching locations…',
  typeMinChars: (n) => `Type at least ${n} characters.`,
  noNeighborhoodFound: (q) => `No matching neighborhood found for “${q}”.`,
  statusSearch: 'Search',
  statusBrowse: 'Browse',
  statusHexes: (n) => `${n} hexes`,
  suggestedSearches: 'Suggested searches',
  errorTitle: 'Error',
  errorDismiss: 'Dismiss error',
  networkError: 'Internet connection required',
  splashAria: 'Loading eodi.me',
  splashCityVibeEngine: 'City Vibe Engine',
  splashConnecting: 'Connecting to engine…',
  splashLoadingDb: 'Loading vector database…',
  splashReady: 'Ready',
  retry: 'Retry',
  settingsAndAbout: 'Settings & About',
  systemInformation: 'System Information',
  appVersion: 'App Version',
  engineSpec: 'Engine Spec',
  databaseStats: 'Database Stats',
  builtAt: 'Built',
  unknown: 'Unknown',
  hexagons: 'hexagons',
  cities: 'cities',
  dataManagement: 'Data Management',
  resetUserData: 'Reset User Data',
  resetUserDataDesc: 'This will clear all bookmarks, saved vibe presets, and search history. The underlying map database is read-only and will not be affected.',
  clearAllLocalData: 'Clear All Local Data',
  resetConfirm: 'Are you sure you want to clear all user data? This cannot be undone.',
  support: 'Support',
  privacy: 'Privacy',
  terms: 'Terms',
  vibeReportTitle: 'Vibe Report',
  closeVibeReport: 'Close vibe report',
  matchWord: 'Match',
  confidenceWord: 'Confidence',
  analyzedVibe: 'Analyzed Vibe',
  vibeMatch: 'Vibe Match',
  vibeSearchHint: 'Global neighborhoods matching this vibe',
  selectedVibe: 'Selected Vibe',
  noData: 'No data',
  selectAnotherHexToCompare: 'Select another hex to compare',
  perCategories: 'Per Categories',
  vibeDifference: 'Vibe Difference',
  perComparison: 'Per Comparison',
  trendActivity: 'Trend Activity',
  population: 'Population',
  topVibe: 'Top Vibe',
  secondVibe: '2nd Vibe',
  vectorDistance: 'Vector Dist.',
  cityId: 'City ID',
  clearCompare: 'Clear Compare',
  compareVibes: 'Compare Vibes',
  standoutReport: 'Standout Report',
  share: 'Share',
  saved: 'Saved',
  save: 'Save',
  copiedToClipboard: 'Copied to clipboard!',
  vibeProfileLabel: 'Vibe Profile',
  compareDeltaHint: 'Bars show how much each vibe axis differs from the compared location',
  analysisPanelAria: 'Vibe panel',
  analysisRailAria: 'Expand vibe panel',
  analysisRailTitle: 'Vibe',
  analysisTitle: 'Location Vibe',
  collapsePanelAria: 'Collapse panel',
  modeSuitability: 'Suitability',
  modeCompare: 'Compare',
  modeExplore: 'Explore',
  suitabilityCriteria: 'Suitability Criteria',
  reset: 'Reset',
  resetWeightsAria: 'Reset weights to default',
  analysisPresets: 'Vibe Presets',
  presetNamePlaceholder: 'Preset name...',
  saveCurrentAsPreset: 'Save current as preset',
  display: 'Display',
  colorLegend: 'Color legend',
  mapLabels: 'Map labels',
  savedLocations: 'Saved Locations',
  emptyBookmarksHint: 'Select a hexagon on the map, then save it as a bookmark.',
  editNoteAria: 'Edit note',
  editNoteTitle: 'Edit note',
  removeBookmarkAria: (name) => `Remove ${name}`,
  addNotePlaceholder: 'Add a note...',
  statistics: 'Statistics',
  hexagonsVisible: 'Hexagons Visible',
  totalInView: 'Total in View',
  modeLabel: 'Mode',
  activeWeights: 'Active Weights',
  totalHexagons: 'Total Hexagons',
  engineModeLabel: 'Engine Mode',
  sigmaLabel: 'Sigma',
  weightDistribution: 'Weight Distribution',
  userDataOnlyReadonlyDb: '100% offline · private',
  openSettingsAria: 'Open settings',
  saveLocationAria: 'Save this location',
  removeBookmarkActionAria: 'Remove bookmark',
  saveToBookmarksTitle: 'Save to bookmarks',
  removeBookmarkTitle: 'Remove bookmark',
  savedToBookmarks: 'Saved to bookmarks',
  removedFromBookmarks: 'Removed from bookmarks',
  locationCompare: 'Location Compare',
  filterCountry: 'Country',
  filterCity: 'City',
  filterNeighborhood: 'Neighborhood',
  filterPlaceholderCountry: 'Filter country',
  filterPlaceholderCity: 'Filter city',
  filterPlaceholderNeighborhood: 'Filter neighborhood',
  filteredHexes: (n) => `${n} filtered hexes`,
  baseHex: 'Base Hex',
  top3SimilarHexes: 'Top 3 Similar Hexes',
  noFilteredHexes: 'No hexes match current filters.',
  noTop3Match: 'Need at least 2 hexes with vibe data.',
  compareWithThis: 'Compare',
  selectAsBase: 'Set as base',
  b2bPoiInput: 'My Locations',
  selectedHexAutoFill: 'Use selected area',
  h3Index: 'Area (H3 hex ID)',
  poiSingleInput: 'Add a Location',
  poiBulkInput: 'Import Multiple Locations',
  importFile: 'Import File',
  applySingle: 'Apply',
  applyBulk: 'Apply All',
  bulkFormatHint: 'JSON array or CSV: h3_index,active,classic,quiet,trendy,nature,urban[,total]',
  bulkResultApplied: (n) => `Applied ${n} locations`,
  bulkResultPartial: (ok, fail) => `Applied ${ok}, ${fail} failed`,
  overlayApplyFailed: 'Could not apply location data',
  selectCountry: 'Select country',
  selectCity: 'Select city',
  selectNeighborhood: 'Select neighborhood',
  allCountries: 'All Countries',
  allCities: 'All Cities',
  allNeighborhoods: 'All Neighborhoods',
  premiumOnly: 'Solo Biz or higher',
  premiumPoiHint: 'Import your own locations to find areas with a matching vibe. Available on Solo Biz plan and above.',
  upgradeNow: 'Upgrade Plan',
  premiumFeature: 'Paid Feature',
  addressSearchPlaceholder: 'Search by address or place name…',
  addressSearchBtn: 'Find Area',
  addressSearching: 'Searching…',
  addressFound: (name) => `Found: ${name}`,
  addressNotFound: 'Address not found. Try a different search.',
  addressSearchHint: 'Type an address to auto-fill the area ID below',
  freeTierNotice: 'Free plan: basic search & map',
  freeTierUpgradeHint: 'Full vibe report, matching & discovery → Personal+',
  upgrade: 'Upgrade',
  subscriptionLabel: 'Subscription',
  renewsExpires: 'Renews / Expires',
  manageLabel: 'Manage',
  freePlanDesc: 'Full vibe radar · Unlimited search worldwide · 100% offline',
  personalPlanDesc: 'Weight presets · Similarity matching · Discovery mode · CSV export',
  soloBizPlanDesc: '+ Custom POI overlay · Self-hosted Docker deploy',
  businessPlanDesc: '+ Batch vibe scoring · Bring Your Own Data (BYOD)',
  enterprisePlanDesc: 'Full REST API access · Custom data schema · Priority support',
  choosePlan: 'Choose Your Plan',
  currentPlanLabel: 'Current',
  renewsLabel: 'Renews',
  mostPopularLabel: 'Most Popular',
  activeLabel: '✓ Active',
  orYearly: 'or',
  deactivateTitle: 'Deactivate this license?',
  deactivateDesc: 'This releases your activation slot. You can re-activate on another machine.',
  yesDeactivate: 'Yes, Deactivate',
  deactivatingLabel: 'Deactivating…',
  cancelLabel: 'Cancel',
  deactivateLabel: 'Deactivate',
  upgradeLabel: 'Upgrade',
  switchLabel: 'Switch',
  hideLicenseKey: '▲ Hide',
  showLicenseKey: '▼ Already have a license key?',
  activatingLabel: 'Activating…',
  activateLicenseBtn: 'Activate License',
  licenseKeyEmailHint: 'License keys are emailed after purchase via LemonSqueezy.',
  activatedSuccess: 'License activated! Your plan has been upgraded.',
  deactivatedSuccess: 'Deactivated. You can now activate on another machine.',
  tryDifferentSearch: 'Try a different search term',
  dominantVibe: 'Dominant Vibe',
  similarityScore: 'Similarity Score',
  suitabilityScore: 'Suitability Score',
  opacityDataIntensity: 'Opacity = data intensity',
  low: 'Low',
  high: 'High',
  selectLocationToCompare: 'Select a location to compare',
  loadingNeighborhoodData: 'Loading neighborhood data…',
  fullVibeReport: 'Full Vibe Report',
  vibeReportUpgradeHint: 'Radar chart · Full vibe breakdown · Compare — available on Personal plan and above',
  upgradeToPersonal: '⚡ Upgrade to Personal',
  cancelPickingCompare: 'Cancel',
  matchReasonLocation: 'Location match',
  matchReasonNeighborhood: 'Nearest match',
  proFeatureRequired: 'This feature requires eodi.me Pro.',
  personalMatchHint: 'Location matching available on Personal plan and above',
  onboardingTitle: 'Welcome to eodi.me',
  onboardingStep1Title: 'Search Any City',
  onboardingStep1Desc: 'Type a city or neighborhood in the search bar — Tokyo, Brooklyn, Le Marais, anywhere in the world.',
  onboardingStep2Title: 'Click a Hexagon',
  onboardingStep2Desc: 'Each hexagon represents a neighborhood. Tap one to see its full Vibe Report — activity, culture, trend scores, and more.',
  onboardingStep3Title: 'Tune Your Vibe',
  onboardingStep3Desc: 'Open the Vibe panel to adjust what matters to you — great food scene, quiet ambiance, high foot traffic — and find your ideal spot.',
  onboardingNext: 'Next',
  onboardingDone: 'Get Started',
  onboardingSkip: 'Skip',
  engineOffline: 'Analysis engine not ready — try restarting the app',
  engineReconnecting: 'Reconnecting…',
  engineReconnected: 'Reconnected',
  mapEmptyHint: 'No data here yet',
  mapEmptySubhint: 'Search for a city or zoom into a data-rich area to explore neighborhoods.',
  faqTitle: 'Help & FAQ',
  faq1q: 'What is a Vibe Score?',
  faq1a: 'A Vibe Score (0–100) rates how well a neighborhood matches your selected criteria. It combines activity levels, cultural richness, tranquility, trendiness, nature access, and urban density — weighted by your preferences.',
  faq2q: 'What do the hexagons represent?',
  faq2a: 'Each hexagon maps to an H3-resolution-8 cell (~460 m across), an industry-standard grid used for spatial analysis. The color shows the dominant vibe; opacity reflects data density.',
  faq3q: 'How do I find my ideal business location?',
  faq3a: 'Open the Vibe panel (right side), choose "Suitability" mode, and move the weight sliders to match your priorities. The map updates live. Click any high-scoring hexagon for a full vibe breakdown.',
  faq4q: 'How does the license work?',
  faq4a: 'Licenses are per-seat and managed via Polar. After purchase you receive a key by email. Enter it in Settings → Subscription → "Already have a key?". You can deactivate and move it to another machine anytime.',
  faq5q: 'Can I use eodi.me offline?',
  faq5a: 'The vibe engine runs locally — no data is sent to external servers. An internet connection is only needed for license validation and map tile loading.',
  faq6q: 'My score seems low — is the data accurate?',
  faq6a: 'Scores depend on available POI density data for that area. Less-covered regions may show lower confidence. Coverage improves continuously. You can add custom POI data on Solo Biz plan and above.',
  updateAvailable: 'Update available',
  updateVersion: (v) => `Version ${v} is ready to install`,
  updateInstall: 'Install & Restart',
  updateDismiss: 'Later',
  updateInstalling: 'Installing update…',
  splashDiagCopy: 'Copy Diagnostic Info',
  splashDiagCopied: 'Copied!',
  splashDiagTitle: 'Startup failed',
  splashDiagPossibleCause: 'Possible cause',
  splashDiagSteps: 'What to try',
  copyDiagnosticBtn: 'Copy Diagnostic Info',
  copyDiagnosticDone: 'Copied!',
  exportCsvBtn: 'Export CSV',
  exportAnalysisBtn: 'Export Vibe Report',
  exportedRows: (n) => `Exported ${n} rows`,
  printReportBtn: 'Print Report',
  compareThisLocation: 'This Location',
  compareOtherLocation: 'Compared',
  faq7q: 'License key not working / activation fails',
  faq7a: 'First, make sure you\'re entering the key in the format EODI-XXXX-XXXX-XXXX exactly as sent by email. If you see "already activated", open Settings → Subscription → Manage and click Deactivate, then re-enter the key. If the problem persists, check your Polar order email for a "Manage License" link.',
  faq8q: 'How do I move my license to a new computer?',
  faq8a: 'Open Settings → Subscription → Manage on your old machine and click Deactivate. This releases the activation slot immediately — no waiting required. Then install eodi.me on the new machine and enter the same license key. You can repeat this process as many times as you need.',
  faq9q: 'App is stuck loading / engine won\'t start',
  faq9a: 'Try these steps in order: (1) Close completely and reopen eodi.me. (2) If still stuck, check that your antivirus is not blocking "eodi-engine" — add an exception if needed. (3) Ensure at least 2 GB of free RAM is available. (4) If you see a "database not found" error, re-run the data setup from the start menu. (5) As a last resort, use Settings → Reset User Data, then restart.',
  presetsGateTitle: 'Weight Presets',
  presetsGateTip: 'Save your favorite weight profiles for quick switching. Available on Personal plan and above.',
  noPresetsYet: 'No presets saved yet. Adjust weights and save.',
  exportGateTip: 'Export data as CSV. Available on Personal plan and above.',
  whatsNewTitle: "What's new in eodi.me",
  whatsNewTagline: '15,000+ neighborhoods · Offline & private · Zero subscription tricks',
  whatsNewClose: 'Get started',
  whatsNewDontShow: "Don't show again",
  whatsNewFreeLabel: 'Free — no account required',
  whatsNewPersonalLabel: 'Personal — $8/mo',
  whatsNewSoloBizLabel: 'Solo Biz — $19/mo',
  whatsNewFreeLine1: '✓ Full neighborhood vibe scores (radar + 6 dimensions)',
  whatsNewFreeLine2: '✓ Unlimited search worldwide · 100% offline',
  whatsNewPersonalLine1: '✓ Weight presets · Similarity matching · CSV export',
  whatsNewPersonalLine2: '✓ Discovery mode — find places that match your lifestyle',
  whatsNewSoloBizLine1: '✓ Custom POI overlay · Self-hosted Docker for teams',
  localApiTitle: 'Local API Access',
  localApiDesc: 'Connect Python, Excel, Node.js or any tool to the local engine.',
  localApiEndpoint: 'Endpoint',
  localApiSessionToken: 'Session Token',
  localApiPersistentKey: 'Persistent API Key',
  localApiKeyNote: 'Persistent key works across app restarts. Use this for stable integrations.',
  localApiRegenerate: 'Regenerate Key',
  localApiRegenerateConfirm: 'This will invalidate the current persistent key. You must restart the app before the new key takes effect.',
  localApiCopied: 'Copied!',
  localApiShow: 'Show',
  localApiHide: 'Hide',
  localApiUpgradeHint: 'Local API access is available on Business plan and above.',
  localApiDocsTitle: 'Available endpoints',
  localApiRestartNote: 'New key saved. Restart the app to apply.',
  billingMonthly: 'Monthly',
  billingAnnual: 'Annual',
  billingSaveLabel: (pct) => `Save ${pct}%`,
  billingAnnualNote: 'billed annually',
  errorNetwork: 'Check your internet connection and try again.',
  errorEngine: 'Cannot connect to local engine. Please check if the background service is running.',
  errorTimeout: 'Request timed out. Please try again in a moment.',
  errorProRequired: 'This feature requires a paid plan. Upgrade in Settings.',
  errorAuth: 'Authentication error. Please restart the app.',
  errorServer: 'Server error. Please try again shortly.',
  errorNotFound: 'No results found. Try a different search term.',
  backToResults: 'Back to results',
  engineNotRunning: 'Engine not running yet.',
  engineFailedToStart: 'Engine failed to start',
  tooltipSuitability: 'Suitability',
  tooltipMatch: 'Match',
  tooltipUnknown: 'Unknown',
  diagnosticReportTitle: 'eodi.me Diagnostic Report',
  copyPythonExample: 'Copy Python example',
  billingPerMonth: '/mo',
  onboardingStepProgress: (step, total) => `Step ${step} of ${total}`,
  emptyStateSearchHint: 'Try a suggested search from the search bar above.',
  browseGuideTitle: 'Explore neighborhoods worldwide',
  browseGuideSubtitle: 'Zoom into a city on the map or search for a location to discover detailed neighborhood insights.',
  browseGuideStep1: 'Search for a city or neighborhood',
  browseGuideStep2: 'Zoom into the map to see hexagon data',
  browseGuideStep3: 'Click a hexagon to view its vibe profile',
  searchResultToast: (n) => `${n} matching areas found`,
  bookmarkAdded: 'Bookmark saved',
  bookmarkRemoved: 'Bookmark removed',
  compareGuideTitle: 'Compare Locations',
  compareGuideBody: 'Select a hexagon on the map or click a result to compare two neighborhoods side by side.',
  compareGuideStep1: '① Click the first location on the map → open report',
  compareGuideStep2: '② Click "Compare" in the report',
  compareGuideStep3: '③ Select the second location to compare',
  fileImportError: 'File could not be read',
  regenFailed: 'Failed to regenerate API key. Please try again.',
  findCompareTarget: 'Find comparison target',
  matchingAreas: 'matching areas',
  statsHexCount: 'Areas',
  statsAvgScore: 'Avg Suit.',
  statsDominantVibe: 'Top Vibe',
  showLegend: 'Show legend',
  hideLegend: 'Hide legend',
  scoreDistribution: 'Score Distribution',
  zoneCount: (n) => `${n} zones`,
  suitabilityScaleNone: 'None',
  suitabilityScaleLow: 'Low',
  suitabilityScaleMedium: 'Medium',
  suitabilityScaleHigh: 'High',
  suitabilityScaleBest: 'Best',
  swapComparison: 'Swap',
  helpTitle: 'Keyboard Shortcuts & Tips',
  openHelpAria: 'Open keyboard shortcuts help',
  shortcutsSection: 'Keyboard Shortcuts',
  quickTipsSection: 'Quick Tips',
  shortcutFocusSearch: 'Focus search',
  shortcutNavigate: 'Navigate results',
  shortcutSelect: 'Select result',
  shortcutClose: 'Close / go back',
  shortcutHelp: 'Show this help',
  shortcutCollapse: 'Collapse sidebar',
  tipClickHex: 'Click any hexagon on the map to open its full Vibe Report with radar chart and dimension breakdown.',
  tipAnalysis: 'Open the Vibe panel → Suitability to adjust weight sliders and find your ideal location live.',
  tipCompare: 'In the Vibe Report, tap "Compare Vibes" to overlay two neighborhoods side-by-side.',
  tipSettings: 'Go to Settings (⚙) → Subscription to manage your plan or activate a license key.',
};

const KO: UiCopy = {
  searchPlaceholder: '동네/지역 검색 (예: 성수동)',
  searchAria: '동네/지역 검색',
  searchButton: '검색',
  searchingButton: '검색 중…',
  clearSearchAria: '검색어 지우기',
  clearSearchTitle: '지우기',
  resultCountAria: (n) => `검색 결과 ${n}개`,
  helperExample: '예: 성수동, 서교동, 강남구',
  helperMinChars: (n) => `Enter로 검색 • 최소 ${n}자`,
  nextStepHint: '지역명을 입력하고 Enter를 누른 뒤, 결과 한 곳을 선택하세요.',
  recentSearches: '최근 검색',
  clear: '지우기',
  suggestions: '추천',
  searchResults: '검색 결과',
  browseResults: '탐색 지역',
  searchResultsCount: (n) => `${n}개 지역`,
  resultsKeyboardHint: '↑/↓ 이동 • Enter 선택',
  matchLabel: '매치',
  searchingLocations: '지역 검색 중…',
  typeMinChars: (n) => `최소 ${n}자 이상 입력해 주세요.`,
  noNeighborhoodFound: (q) => `“${q}” 검색 결과가 없습니다.`,
  statusSearch: '검색',
  statusBrowse: '탐색',
  statusHexes: (n) => `${n}개 헥사곤`,
  suggestedSearches: '추천 검색어',
  errorTitle: '오류',
  errorDismiss: '오류 닫기',
  networkError: '인터넷 연결 필요',
  splashAria: 'eodi.me 로딩 중',
  splashCityVibeEngine: 'City Vibe Engine',
  splashConnecting: '엔진에 연결 중…',
  splashLoadingDb: '벡터 데이터베이스 로딩 중…',
  splashReady: '준비 완료',
  retry: '다시 시도',
  settingsAndAbout: '설정 및 정보',
  systemInformation: '시스템 정보',
  appVersion: '앱 버전',
  engineSpec: '엔진 스펙',
  databaseStats: '데이터베이스 통계',
  builtAt: '빌드 시각',
  unknown: '알 수 없음',
  hexagons: '헥사곤',
  cities: '도시',
  dataManagement: '데이터 관리',
  resetUserData: '사용자 데이터 초기화',
  resetUserDataDesc: '북마크, 저장된 프리셋, 분석 기록이 삭제됩니다. 지도 원본 DB는 읽기 전용이라 변경되지 않습니다.',
  clearAllLocalData: '모든 로컬 데이터 삭제',
  resetConfirm: '모든 사용자 데이터를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.',
  support: '지원',
  privacy: '개인정보',
  terms: '이용약관',
  vibeReportTitle: '바이브 리포트',
  closeVibeReport: '바이브 리포트 닫기',
  matchWord: '매치',
  confidenceWord: '신뢰도',
  analyzedVibe: '분석 바이브',
  vibeMatch: '바이브 매치',
  vibeSearchHint: '이 바이브와 유사한 전 세계 동네',
  selectedVibe: '선택된 바이브',
  noData: '데이터 없음',
  selectAnotherHexToCompare: '비교할 다른 헥사곤을 선택하세요',
  perCategories: '카테고리별',
  vibeDifference: '바이브 차이',
  perComparison: '비교 분포',
  trendActivity: '트렌드 활동',
  population: '인구',
  topVibe: '상위 바이브',
  secondVibe: '2순위 바이브',
  vectorDistance: '벡터 거리',
  cityId: '도시 ID',
  clearCompare: '비교 해제',
  compareVibes: '바이브 비교',
  standoutReport: '주요 리포트',
  share: '공유',
  saved: '저장됨',
  save: '저장',
  copiedToClipboard: '클립보드에 복사됨!',
  vibeProfileLabel: '바이브 프로필',
  compareDeltaHint: '비교 지역과 각 바이브 축의 차이를 보여줍니다',
  analysisPanelAria: '바이브 패널',
  analysisRailAria: '바이브 패널 펼치기',
  analysisRailTitle: '바이브',
  analysisTitle: '동네 바이브',
  collapsePanelAria: '패널 접기',
  modeSuitability: '적합도',
  modeCompare: '비교',
  modeExplore: '탐색',
  suitabilityCriteria: '적합도 기준',
  reset: '초기화',
  resetWeightsAria: '가중치를 기본값으로 초기화',
  analysisPresets: '바이브 프리셋',
  presetNamePlaceholder: '프리셋 이름...',
  saveCurrentAsPreset: '현재 설정을 프리셋으로 저장',
  display: '표시',
  colorLegend: '색상 범례',
  mapLabels: '지도 라벨',
  savedLocations: '저장한 위치',
  emptyBookmarksHint: '지도에서 헥사곤을 선택한 뒤 북마크로 저장하세요.',
  editNoteAria: '메모 수정',
  editNoteTitle: '메모 수정',
  removeBookmarkAria: (name) => `${name} 삭제`,
  addNotePlaceholder: '메모 추가...',
  statistics: '통계',
  hexagonsVisible: '표시 중 헥사곤',
  totalInView: '화면 내 전체',
  modeLabel: '모드',
  activeWeights: '활성 가중치',
  totalHexagons: '전체 헥사곤',
  engineModeLabel: '엔진 모드',
  sigmaLabel: '시그마',
  weightDistribution: '가중치 분포',
  userDataOnlyReadonlyDb: '100% 오프라인 · 프라이빗',
  openSettingsAria: '설정 열기',
  saveLocationAria: '이 위치 저장',
  removeBookmarkActionAria: '북마크 제거',
  saveToBookmarksTitle: '북마크에 저장',
  removeBookmarkTitle: '북마크 제거',
  savedToBookmarks: '북마크에 저장됨',
  removedFromBookmarks: '북마크에서 제거됨',
  locationCompare: '지역 비교',
  filterCountry: '국가',
  filterCity: '도시',
  filterNeighborhood: '동네',
  filterPlaceholderCountry: '국가 필터',
  filterPlaceholderCity: '도시 필터',
  filterPlaceholderNeighborhood: '동네 필터',
  filteredHexes: (n) => `필터 결과 ${n}개 헥사곤`,
  baseHex: '기준 헥사곤',
  top3SimilarHexes: '유사 헥사곤 TOP 3',
  noFilteredHexes: '현재 필터에 맞는 헥사곤이 없습니다.',
  noTop3Match: '바이브 데이터가 있는 헥사곤 2개 이상이 필요합니다.',
  compareWithThis: '비교',
  selectAsBase: '기준 선택',
  b2bPoiInput: '내 장소',
  selectedHexAutoFill: '선택 지역 사용',
  h3Index: '지역 (H3 헥사곤 ID)',
  poiSingleInput: '장소 추가',
  poiBulkInput: '여러 장소 가져오기',
  importFile: '파일 불러오기',
  applySingle: '적용',
  applyBulk: '전체 적용',
  bulkFormatHint: 'JSON 배열 또는 CSV: h3_index,active,classic,quiet,trendy,nature,urban[,total]',
  bulkResultApplied: (n) => `${n}개 장소 적용 완료`,
  bulkResultPartial: (ok, fail) => `${ok}개 적용, ${fail}개 실패`,
  overlayApplyFailed: '장소 데이터를 적용할 수 없습니다',
  selectCountry: '국가 선택',
  selectCity: '도시 선택',
  selectNeighborhood: '동네 선택',
  allCountries: '전체 국가',
  allCities: '전체 도시',
  allNeighborhoods: '전체 동네',
  premiumOnly: 'Solo Biz 이상 플랜',
  premiumPoiHint: '내 매장·지점을 입력하면 같은 바이브를 가진 지역을 전 세계에서 찾아드립니다. Solo Biz 이상 플랜에서 사용 가능합니다.',
  upgradeNow: '플랜 업그레이드',
  premiumFeature: '유료 전용 기능',
  freeTierNotice: '무료 플랜: 기본 검색 · 지도 이용 가능',
  freeTierUpgradeHint: '전체 분석 · 매칭 · 탐색 → Personal 이상',
  upgrade: '업그레이드',
  subscriptionLabel: '구독',
  renewsExpires: '갱신/만료일',
  manageLabel: '관리',
  freePlanDesc: '전체 바이브 레이더 · 전 세계 무제한 검색 · 100% 오프라인',
  personalPlanDesc: '가중치 프리셋 · 유사 매칭 · 탐색 모드 · CSV 내보내기',
  soloBizPlanDesc: '+ 커스텀 POI 오버레이 · 팀용 Docker 자체 호스팅',
  businessPlanDesc: '+ 배치 분석 · BYOD (자체 데이터)',
  enterprisePlanDesc: 'REST API 전체 접근 · 커스텀 데이터 스키마 · 우선 지원',
  choosePlan: '플랜 선택',
  currentPlanLabel: '현재 플랜',
  renewsLabel: '갱신',
  mostPopularLabel: '인기 플랜',
  activeLabel: '✓ 현재 플랜',
  orYearly: '또는',
  deactivateTitle: '라이선스를 비활성화할까요?',
  deactivateDesc: '비활성화하면 활성화 슬롯이 해제됩니다. 다른 기기에서 다시 활성화할 수 있습니다.',
  yesDeactivate: '비활성화',
  deactivatingLabel: '비활성화 중…',
  cancelLabel: '취소',
  deactivateLabel: '비활성화',
  upgradeLabel: '업그레이드',
  switchLabel: '변경',
  hideLicenseKey: '▲ 숨기기',
  showLicenseKey: '▼ 이미 라이선스 키가 있으신가요?',
  activatingLabel: '활성화 중…',
  activateLicenseBtn: '라이선스 활성화',
  licenseKeyEmailHint: 'LemonSqueezy 구매 후 이메일로 라이선스 키가 발송됩니다.',
  activatedSuccess: '라이선스가 활성화되었습니다! 플랜이 업그레이드되었습니다.',
  deactivatedSuccess: '비활성화되었습니다. 다른 기기에서 활성화할 수 있습니다.',
  tryDifferentSearch: '다른 검색어를 입력해 보세요',
  dominantVibe: '주요 분위기',
  similarityScore: '유사도 점수',
  suitabilityScore: '적합도 점수',
  opacityDataIntensity: '투명도 = 데이터 밀도',
  low: '낮음',
  high: '높음',
  selectLocationToCompare: '비교할 지역을 선택하세요',
  loadingNeighborhoodData: '동네 데이터 로딩 중…',
  fullVibeReport: '전체 바이브 리포트',
  vibeReportUpgradeHint: '상세 분석 · 레이더 차트 · 비교 기능은\nPersonal 플랜 이상에서 이용 가능합니다',
  upgradeToPersonal: '⚡ Personal로 업그레이드',
  cancelPickingCompare: '선택 취소',
  matchReasonLocation: '위치 일치',
  matchReasonNeighborhood: '인근 지역 매칭',
  proFeatureRequired: 'Pro 기능입니다. 라이선스를 활성화해 주세요.',
  personalMatchHint: 'Personal 이상 플랜에서 유사 상권 비교 가능',
  onboardingTitle: 'eodi.me에 오신 것을 환영합니다',
  onboardingStep1Title: '도시 검색',
  onboardingStep1Desc: '검색창에 도시나 동네 이름을 입력하세요 — 성수동, 강남, 도쿄, 파리 등 전 세계 어디든 검색할 수 있습니다.',
  onboardingStep2Title: '헥사곤 클릭',
  onboardingStep2Desc: '각 헥사곤은 하나의 동네를 나타냅니다. 클릭하면 활동성, 문화, 트렌드 점수 등을 담은 바이브 리포트를 볼 수 있습니다.',
  onboardingStep3Title: '분석 맞춤 설정',
  onboardingStep3Desc: '오른쪽 분석 패널에서 중요한 요소를 조정하세요 — 활발한 상권, 조용한 분위기, 높은 유동 인구 — 원하는 입지를 찾아드립니다.',
  onboardingNext: '다음',
  onboardingDone: '시작하기',
  onboardingSkip: '건너뛰기',
  engineOffline: '분석 엔진이 준비되지 않았습니다 — 앱을 다시 시작해 보세요',
  engineReconnecting: '재연결 중…',
  engineReconnected: '재연결됨',
  mapEmptyHint: '이 지역에는 아직 데이터가 없습니다',
  mapEmptySubhint: '도시를 검색하거나 데이터가 풍부한 지역으로 확대해 보세요.',
  faqTitle: '도움말 & FAQ',
  faq1q: '바이브 점수란 무엇인가요?',
  faq1a: '바이브 점수(0~100)는 동네가 선택한 기준에 얼마나 부합하는지를 나타냅니다. 활동성, 문화, 조용함, 트렌디함, 자연 접근성, 도시 밀도를 가중치 설정에 따라 종합 평가합니다.',
  faq2q: '헥사곤은 무엇을 나타내나요?',
  faq2a: '각 헥사곤은 H3 해상도-8 셀(약 460m)에 해당하며, 공간 분석에서 사용하는 표준 격자입니다. 색상은 주요 분위기를, 투명도는 데이터 밀도를 나타냅니다.',
  faq3q: '이상적인 입지는 어떻게 찾나요?',
  faq3a: '오른쪽 분석 패널을 열고 "적합도" 모드를 선택한 뒤, 가중치 슬라이더를 내 우선순위에 맞게 조정하세요. 지도가 실시간으로 업데이트됩니다. 높은 점수의 헥사곤을 클릭하면 상세 분석을 볼 수 있습니다.',
  faq4q: '라이선스는 어떻게 작동하나요?',
  faq4a: '라이선스는 1인 1좌석 방식으로 LemonSqueezy를 통해 관리됩니다. 구매 후 이메일로 키가 발송됩니다. 설정 → 구독 → "이미 키가 있으신가요?"에 입력하면 됩니다. 언제든지 비활성화 후 다른 기기에서 재활성화할 수 있습니다.',
  faq5q: '오프라인으로 사용할 수 있나요?',
  faq5a: '핵심 지도와 분석 엔진은 로컬에서 실행되며, 분석 중에는 외부 서버로 데이터가 전송되지 않습니다. 인터넷 연결은 라이선스 확인과 지도 타일 로딩에만 필요합니다.',
  faq6q: '점수가 낮게 나오는데, 데이터가 정확한가요?',
  faq6a: '점수는 해당 지역의 POI 데이터 밀도에 따라 달라집니다. 아직 커버리지가 낮은 지역은 신뢰도가 낮을 수 있으며, 데이터는 지속적으로 개선됩니다. Solo Biz 이상 플랜에서 직접 POI 데이터를 추가할 수 있습니다.',
  updateAvailable: '업데이트 가능',
  updateVersion: (v) => `버전 ${v}을(를) 설치할 준비가 되었습니다`,
  updateInstall: '설치 후 재시작',
  updateDismiss: '나중에',
  updateInstalling: '업데이트 설치 중…',
  splashDiagCopy: '진단 정보 복사',
  splashDiagCopied: '복사됨!',
  splashDiagTitle: '시작 실패',
  splashDiagPossibleCause: '예상 원인',
  splashDiagSteps: '해결 방법',
  copyDiagnosticBtn: '진단 정보 복사',
  copyDiagnosticDone: '복사됨!',
  exportCsvBtn: 'CSV 내보내기',
  exportAnalysisBtn: '바이브 리포트 내보내기',
  exportedRows: (n) => `${n}개 행 내보내기 완료`,
  printReportBtn: '리포트 인쇄',
  compareThisLocation: '현재 위치',
  compareOtherLocation: '비교 위치',
  faq7q: '라이선스 키가 작동하지 않거나 활성화에 실패합니다',
  faq7a: '키가 이메일에서 전송된 EODI-XXXX-XXXX-XXXX 형식 그대로인지 확인하세요. "이미 활성화됨" 오류가 나타나면 설정 → 구독 → 관리에서 비활성화 후 다시 입력하세요. 문제가 계속되면 Polar 주문 이메일의 "라이선스 관리" 링크를 확인하세요.',
  faq8q: '새 컴퓨터로 라이선스를 이전하려면 어떻게 하나요?',
  faq8a: '기존 기기에서 설정 → 구독 → 관리를 열고 비활성화를 클릭하세요. 활성화 슬롯이 즉시 해제됩니다. 새 기기에 eodi.me를 설치한 뒤 동일한 라이선스 키를 입력하면 됩니다. 횟수 제한 없이 반복할 수 있습니다.',
  faq9q: '앱이 로딩 중에 멈추거나 엔진이 시작되지 않습니다',
  faq9a: '순서대로 시도해 보세요: (1) eodi.me를 완전히 종료 후 다시 시작. (2) 바이러스 백신이 "eodi-engine"을 차단하는지 확인 — 필요시 예외 추가. (3) 여유 RAM이 2GB 이상인지 확인. (4) "데이터베이스 없음" 오류라면 시작 메뉴에서 데이터 설정을 다시 실행. (5) 최후 수단으로 설정 → 사용자 데이터 초기화 후 재시작.',
  presetsGateTitle: '가중치 프리셋',
  presetsGateTip: '즐겨 쓰는 가중치 프로필을 저장해 빠르게 전환하세요. Personal 플랜 이상에서 사용 가능합니다.',
  noPresetsYet: '저장된 프리셋이 없습니다. 가중치를 조정하고 저장해 보세요.',
  exportGateTip: 'CSV로 데이터 내보내기. Personal 플랜 이상에서 사용 가능합니다.',
  whatsNewTitle: 'eodi.me에 오신 것을 환영합니다',
  whatsNewTagline: '전 세계 15,000개+ 동네 · 오프라인 & 완전 개인정보 보호 · 과도한 유료 유도 없음',
  whatsNewClose: '시작하기',
  whatsNewDontShow: '다시 보지 않기',
  whatsNewFreeLabel: '무료 — 계정 불필요',
  whatsNewPersonalLabel: 'Personal — 월 $8',
  whatsNewSoloBizLabel: 'Solo Biz — 월 $19',
  whatsNewFreeLine1: '✓ 동네 바이브 점수 전체 공개 (레이더 + 6개 차원)',
  whatsNewFreeLine2: '✓ 전 세계 무제한 검색 · 100% 오프라인',
  whatsNewPersonalLine1: '✓ 가중치 프리셋 · 유사 위치 매칭 · CSV 내보내기',
  whatsNewPersonalLine2: '✓ 탐색 모드 — 나의 라이프스타일에 맞는 곳 찾기',
  whatsNewSoloBizLine1: '✓ 커스텀 POI 오버레이 · 팀용 Docker 자체 호스팅',
  localApiTitle: '로컬 API 접근',
  localApiDesc: 'Python, Excel, Node.js 등 외부 도구를 로컬 엔진에 연결하세요.',
  localApiEndpoint: '엔드포인트',
  localApiSessionToken: '세션 토큰',
  localApiPersistentKey: '영구 API 키',
  localApiKeyNote: '영구 키는 앱을 재시작해도 변경되지 않습니다. 안정적인 연동에 사용하세요.',
  localApiRegenerate: '키 재생성',
  localApiRegenerateConfirm: '현재 영구 키가 무효화됩니다. 새 키 적용을 위해 앱을 재시작해야 합니다.',
  localApiCopied: '복사됨!',
  localApiShow: '표시',
  localApiHide: '숨기기',
  localApiUpgradeHint: '로컬 API는 Business 플랜 이상에서 사용 가능합니다.',
  localApiDocsTitle: '사용 가능한 엔드포인트',
  localApiRestartNote: '새 키가 저장되었습니다. 앱을 재시작하면 적용됩니다.',
  billingMonthly: '월간',
  billingAnnual: '연간',
  billingSaveLabel: (pct) => `${pct}% 절약`,
  billingAnnualNote: '연간 청구',
  errorNetwork: '인터넷 연결을 확인하고 다시 시도해 주세요.',
  errorEngine: '로컬 엔진에 연결할 수 없습니다. 백그라운드 서비스가 실행 중인지 확인해 주세요.',
  errorTimeout: '요청 시간이 초과됐습니다. 잠시 후 다시 시도해 주세요.',
  errorProRequired: 'Pro 기능입니다. 설정에서 플랜을 업그레이드해 주세요.',
  errorAuth: '인증 오류입니다. 앱을 재시작해 주세요.',
  errorServer: '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
  errorNotFound: '검색 결과를 찾을 수 없습니다. 다른 검색어를 입력해 보세요.',
  backToResults: '결과 목록으로',
  engineNotRunning: '엔진이 아직 실행되지 않았습니다.',
  engineFailedToStart: '엔진을 시작할 수 없습니다',
  tooltipSuitability: '적합도',
  tooltipMatch: '매칭',
  tooltipUnknown: '알 수 없음',
  diagnosticReportTitle: 'eodi.me 진단 보고서',
  copyPythonExample: 'Python 예제 복사',
  billingPerMonth: '/월',
  onboardingStepProgress: (step, total) => `${total}단계 중 ${step}단계`,
  emptyStateSearchHint: '검색창의 추천 검색어를 시도해 보세요.',
  browseGuideTitle: '전 세계 동네를 탐색하세요',
  browseGuideSubtitle: '지도에서 도시를 확대하거나 지역을 검색하여 상세한 동네 분석을 확인하세요.',
  browseGuideStep1: '도시나 동네를 검색하세요',
  browseGuideStep2: '지도를 확대하여 헥사곤 데이터를 확인하세요',
  browseGuideStep3: '헥사곤을 클릭하여 분위기 프로필을 확인하세요',
  searchResultToast: (n) => `${n}개의 일치하는 지역을 찾았습니다`,
  bookmarkAdded: '북마크 저장됨',
  bookmarkRemoved: '북마크 제거됨',
  compareGuideTitle: '지역 비교',
  compareGuideBody: '지도에서 헥사곤을 선택하거나 검색 결과에서 결과를 클릭하면 두 지역의 바이브 프로필을 나란히 비교할 수 있습니다.',
  compareGuideStep1: '① 지도에서 첫 번째 지역 클릭 → 리포트 오픈',
  compareGuideStep2: '② 리포트에서 "비교" 버튼 클릭',
  compareGuideStep3: '③ 비교할 두 번째 지역 선택',
  fileImportError: '파일을 읽을 수 없습니다',
  regenFailed: 'API 키 재생성에 실패했습니다. 다시 시도해 주세요.',
  findCompareTarget: '비교 대상 찾기',
  matchingAreas: '개 지역',
  statsHexCount: '영역 수',
  statsAvgScore: '평균 적합도',
  statsDominantVibe: '주요 분위기',
  showLegend: '범례 표시',
  hideLegend: '범례 숨김',
  scoreDistribution: '점수 분포',
  zoneCount: (n) => `${n}개 구역`,
  suitabilityScaleNone: '없음',
  suitabilityScaleLow: '낮음',
  suitabilityScaleMedium: '보통',
  suitabilityScaleHigh: '높음',
  suitabilityScaleBest: '최상',
  swapComparison: '교체',
  helpTitle: '단축키 & 사용 팁',
  openHelpAria: '키보드 단축키 도움말 열기',
  shortcutsSection: '키보드 단축키',
  quickTipsSection: '빠른 팁',
  shortcutFocusSearch: '검색 포커스',
  shortcutNavigate: '결과 탐색',
  shortcutSelect: '결과 선택',
  shortcutClose: '닫기 / 뒤로',
  shortcutHelp: '도움말 열기',
  shortcutCollapse: '사이드바 접기',
  tipClickHex: '지도의 헥사곤을 클릭하면 레이더 차트와 6개 차원 분석이 포함된 전체 바이브 리포트를 볼 수 있습니다.',
  tipAnalysis: '바이브 패널 → 적합도 모드에서 가중치 슬라이더를 조정해 나에게 맞는 지역을 실시간으로 찾아보세요.',
  tipCompare: '바이브 리포트에서 "바이브 비교"를 누르면 두 지역을 나란히 비교할 수 있습니다.',
  tipSettings: '설정(⚙)에서 구독 관리 또는 라이선스 키를 활성화할 수 있습니다.',
  addressSearchPlaceholder: '주소 또는 장소명으로 검색…',
  addressSearchBtn: '지역 찾기',
  addressSearching: '검색 중…',
  addressFound: (name) => `찾음: ${name}`,
  addressNotFound: '주소를 찾을 수 없습니다. 다른 검색어를 입력해 주세요.',
  addressSearchHint: '주소를 입력하면 지역 ID가 자동으로 채워집니다',
};

import { JA } from './locales/ja';
import { ZH } from './locales/zh';
import { ES } from './locales/es';
import { FR } from './locales/fr';
import { DE } from './locales/de';
import { PT } from './locales/pt';

const LOCALE_MAP: Record<UiLocale, UiCopy> = {
  en: EN,
  ko: KO,
  ja: JA,
  zh: ZH,
  es: ES,
  fr: FR,
  de: DE,
  pt: PT,
};

/** Language labels for the Settings language selector */
export const LOCALE_LABELS: Record<UiLocale, string> = {
  en: 'English',
  ko: '한국어',
  ja: '日本語',
  zh: '中文（简体）',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  pt: 'Português',
};

/** Short display code shown on the language button */
export const LOCALE_SHORT: Record<UiLocale, string> = {
  en: 'EN', ko: 'KO', ja: 'JA', zh: 'ZH',
  es: 'ES', fr: 'FR', de: 'DE', pt: 'PT',
};

export const ALL_LOCALES: UiLocale[] = ['en', 'ko', 'ja', 'zh', 'es', 'fr', 'de', 'pt'];

export function resolveUiLocale(locale?: string): UiLocale {
  if (!locale) return 'en';
  const tag = locale.toLowerCase();
  if (tag.startsWith('ko')) return 'ko';
  if (tag.startsWith('ja')) return 'ja';
  if (tag.startsWith('zh')) return 'zh';
  if (tag.startsWith('es')) return 'es';
  if (tag.startsWith('fr')) return 'fr';
  if (tag.startsWith('de')) return 'de';
  if (tag.startsWith('pt')) return 'pt';
  return 'en';
}

export function getUiCopy(locale?: string): UiCopy {
  return LOCALE_MAP[resolveUiLocale(locale)] ?? EN;
}
