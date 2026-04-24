import { useState, useEffect, useImperativeHandle, forwardRef, useMemo, useRef, useCallback } from 'react'
import { Box, Heading, Text, HStack } from '@chakra-ui/react'
import { FlowData, JobData, TranslationUnit } from '../types'
import { QualityModel } from '../types/qualityModel'
import ScreenshotViewer from './ScreenshotViewer'
import TextSegmentEditor from './TextSegmentEditor'
import GlassBox from './GlassBox'
import ResizablePane from './ResizablePane'
import InfoModal from './InfoModal'
import { TranslationFilterControls } from './TranslationFilterControls'
import { useKeyboardNavigation } from '../hooks/useKeyboardNavigation'
import { useOptimalPaneSplit } from '../hooks/useOptimalPaneSplit'
import { normalizedToString } from '../utils/normalizedText'
import { normalizedArraysEqual } from '../utils/normalizedComparison'
import { calculateTER, calculateSegmentWordCounts } from '../utils/metrics'

interface SourceDisplayInfo {
  pluginName: string
  locationLabel: string
  locationUrl?: string
  filename?: string
}

interface LoadingProgress {
  current: number
  total: number
}

interface TranslationEditorProps {
  flowData: FlowData | null
  jobData: JobData | null
  originalJobData: JobData | null
  savedJobData: JobData | null
  pageImages: Map<string, string> | null
  loadingProgress: LoadingProgress | null
  onTranslationUnitChange: (tu: TranslationUnit) => void
  onCandidateSelect: (guid: string, candidateIndex: number) => void
  onInstructionsOpen?: () => void
  sourceInfo?: SourceDisplayInfo
  qualityModel: QualityModel | null
  ept: number | null
  onReviewToggle: (guid: string, reviewed: boolean, sttr?: number, attr?: number) => void
  onSegmentFocusStart?: (guid: string) => void
  onSegmentFocusEnd?: (guid: string, wasApproved: boolean) => number | null
  onSegmentEdited?: (guid: string) => void
  onPageTimerStart?: (pageIndex: number) => void
  onPageTimerStop?: () => { pageIndex: number; elapsed: number } | null
}

export interface TranslationEditorRef {
  openInstructions: () => void
}

export const TranslationEditor = forwardRef<TranslationEditorRef, TranslationEditorProps>(({
  flowData,
  jobData,
  originalJobData,
  savedJobData,
  pageImages,
  loadingProgress,
  onTranslationUnitChange,
  onCandidateSelect,
  onInstructionsOpen,
  sourceInfo,
  qualityModel,
  ept,
  onReviewToggle,
  onSegmentFocusStart,
  onSegmentFocusEnd,
  onSegmentEdited,
  onPageTimerStart,
  onPageTimerStop,
}, ref) => {
  const [currentPageIndex, setCurrentPageIndex] = useState(0)
  const [activeSegmentGuid, setActiveSegmentGuid] = useState<string | null>(null)
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false)
  const [showOnlyNonReviewed, setShowOnlyNonReviewed] = useState(false)
  const [filterText, setFilterText] = useState('')
  const userDeselected = useRef(false)
  // Track where the last segment selection came from
  const segmentClickSource = useRef<'screenshot' | 'editor' | null>(null)

  // Expose openInstructions method via ref (keeping method name for backward compatibility)
  useImperativeHandle(ref, () => ({
    openInstructions: () => setIsInfoModalOpen(true)
  }), [])
  const [searchableFields, setSearchableFields] = useState({
    source: true,
    target: true,
    notes: true,
    rid: true,
    sid: true,
    guid: true,
  })

  // Calculate optimal pane split based on screenshot dimensions from flow metadata
  const { optimalLeftWidth } = useOptimalPaneSplit(flowData)
  
  // Wrapper for setActiveSegmentGuid that tracks user deselection
  const handleSetActiveSegmentGuid = (guid: string | null, source: 'screenshot' | 'editor' | null = null) => {
    if (guid === null && activeSegmentGuid !== null) {
      userDeselected.current = true
    } else if (guid !== null) {
      userDeselected.current = false
    }
    segmentClickSource.current = source
    setActiveSegmentGuid(guid)
  }

  // Handler for screenshot segment clicks - only scrolls editor, not screenshot
  const handleScreenshotSegmentClick = (guid: string) => {
    handleSetActiveSegmentGuid(guid, 'screenshot')
  }

  // Handler for editor segment clicks - scrolls screenshot to first occurrence
  const handleEditorSegmentFocus = (guid: string | null) => {
    handleSetActiveSegmentGuid(guid, 'editor')
  }
  
  // Show instructions modal only when a new file is loaded with language info
  const sourceLang = jobData?.sourceLang
  const targetLang = jobData?.targetLang
  const currentJobGuidRef = useRef<string | undefined>(undefined)
  
  useEffect(() => {
    if (jobData && (sourceLang || targetLang)) {
      // Use jobGuid to detect new file loads since it's unique per job
      // and doesn't change when translation units are edited
      if (currentJobGuidRef.current !== jobData.jobGuid) {
        // Reset filters to default values when loading new file
        setShowOnlyNonReviewed(false)
        setFilterText('')
        setSearchableFields({
          source: true,
          target: true,
          notes: true,
          rid: true,
          sid: true,
          guid: true,
        })

        if (onInstructionsOpen) {
          setIsInfoModalOpen(true)
          onInstructionsOpen()
        }
        currentJobGuidRef.current = jobData.jobGuid
      }
    } else {
      // Reset ref when jobData is null/undefined (no file loaded)
      currentJobGuidRef.current = undefined
    }
  }, [jobData, sourceLang, targetLang, onInstructionsOpen])

  // Calculate TER (Translation Error Rate)
  const ter = useMemo(() => {
    return calculateTER(jobData, originalJobData)
  }, [jobData, originalJobData])

  // Start page timer when page changes (for ATTR calculation)
  useEffect(() => {
    if (flowData && currentPageIndex >= 0) {
      onPageTimerStart?.(currentPageIndex)
    }
  }, [currentPageIndex, flowData, onPageTimerStart])

  // Calculate segment and word counts
  const segmentWordCounts = useMemo(() => {
    return calculateSegmentWordCounts(jobData)
  }, [jobData])

  const navigatePage = (direction: number) => {
    if (!flowData) return
    const newIndex = currentPageIndex + direction
    if (newIndex >= 0 && newIndex < flowData.pages.length) {
      setCurrentPageIndex(newIndex)
      userDeselected.current = false // Reset on page navigation
      setActiveSegmentGuid(null)
    }
  }
  
  const currentPage = flowData?.pages[currentPageIndex]
  
  // Filter function for translation units
  const filterTranslationUnits = (tus: TranslationUnit[]): TranslationUnit[] => {
    let filtered = tus

    // Create a map of original translation units by GUID for quick lookup
    const originalTuMap = new Map<string, TranslationUnit>()
    if (originalJobData?.tus) {
      originalJobData.tus.forEach(tu => {
        originalTuMap.set(tu.guid, tu)
      })
    }

    // Apply review status filter first
    if (showOnlyNonReviewed) {
      filtered = filtered.filter(tu => !tu.ts)
    }

    // Then apply text search filter
    if (!filterText.trim()) return filtered

    const searchText = filterText.toLowerCase()
    return filtered.filter(tu => {
      // Search in source text
      if (searchableFields.source) {
        const sourceText = tu.nsrc ? normalizedToString(tu.nsrc).toLowerCase() : ''
        if (sourceText.includes(searchText)) return true
      }
      
      // Search in target text
      if (searchableFields.target) {
        // Use original target text for filtering so edits don't affect filter results
        const originalTu = originalTuMap.get(tu.guid)
        const targetToSearch = originalTu?.ntgt ?? tu.ntgt
        const targetText = targetToSearch ? normalizedToString(targetToSearch).toLowerCase() : ''
        if (targetText.includes(searchText)) return true
      }
      
      // Search in notes
      if (searchableFields.notes && tu.notes) {
        let notesText = ''
        if (typeof tu.notes === 'object' && 'desc' in tu.notes && tu.notes.desc) {
          notesText = tu.notes.desc.toLowerCase()
        } else if (typeof tu.notes === 'string') {
          notesText = tu.notes.toLowerCase()
        }
        if (notesText.includes(searchText)) return true
      }
      
      // Search in rid, sid, guid
      if (searchableFields.rid) {
        const rid = tu.rid !== undefined ? String(tu.rid).toLowerCase() : ''
        if (rid.includes(searchText)) return true
      }
      
      if (searchableFields.sid) {
        const sid = tu.sid !== undefined ? String(tu.sid).toLowerCase() : ''
        if (sid.includes(searchText)) return true
      }
      
      if (searchableFields.guid) {
        const guid = tu.guid ? tu.guid.toLowerCase() : ''
        if (guid.includes(searchText)) return true
      }
      
      return false
    })
  }
  
  // Get filtered job data
  const filteredJobData = jobData ? { ...jobData, tus: filterTranslationUnits(jobData.tus) } : null

  // Handle marking current segment as reviewed before navigation
  const handleBeforeNavigate = () => {
    if (!jobData || !activeSegmentGuid) return

    // Stop the segment timer (approved via Cmd+Enter)
    const sttr = onSegmentFocusEnd?.(activeSegmentGuid, true)

    // Mark the current segment as reviewed with STTR
    onReviewToggle(activeSegmentGuid, true, sttr ?? undefined)
  }

  // Mark all visible segments on current page as reviewed
  const handleMarkAllVisibleAsReviewed = () => {
    if (!currentPage || !currentPage.segments) return

    // Stop page timer and get elapsed time
    const timerResult = onPageTimerStop?.()

    // Filter for visible segments (width > 0 and height > 0)
    const visibleSegments = currentPage.segments.filter(
      segment => segment.width > 0 && segment.height > 0
    )

    const segmentCount = visibleSegments.length
    if (segmentCount === 0) return

    // Calculate ATTR (average time per segment)
    const attr = timerResult ? Math.round(timerResult.elapsed / segmentCount) : undefined

    // Mark all visible segments as reviewed with ATTR
    visibleSegments.forEach(segment => {
      onReviewToggle(segment.g, true, undefined, attr)
    })

    // Restart page timer for potential next batch on same page
    onPageTimerStart?.(currentPageIndex)
  }

  // Compute the ordered list of guids for navigation (matches TextSegmentEditor logic)
  const segmentGuids = useMemo(() => {
    if (!filteredJobData) return []
    if (currentPage) {
      // Get set of guids that appear on this page
      const pageGuids = new Set(currentPage.segments?.map(s => s.g) || [])
      // Filter to TUs that appear on this page, preserving job file order
      return filteredJobData.tus
        .filter(tu => pageGuids.has(tu.guid))
        .map(tu => tu.guid)
    }
    return filteredJobData.tus.map(tu => tu.guid)
  }, [currentPage, filteredJobData])

  // Create lookup maps for segment color calculation
  const tusByGuid = useMemo(() =>
    new Map(jobData?.tus.map(tu => [tu.guid, tu]) || []),
    [jobData?.tus]
  )
  const originalTusByGuid = useMemo(() =>
    new Map(originalJobData?.tus.map(tu => [tu.guid, tu]) || []),
    [originalJobData?.tus]
  )
  const savedTusByGuid = useMemo(() =>
    new Map(savedJobData?.tus.map(tu => [tu.guid, tu]) || []),
    [savedJobData?.tus]
  )

  // Get segment color based on review status (matches TextSegmentEditor logic)
  const getSegmentColor = useCallback((guid: string): string => {
    const tu = tusByGuid.get(guid)
    const originalTu = originalTusByGuid.get(guid)
    const savedTu = savedTusByGuid.get(guid)

    if (!tu || !originalTu || !savedTu) return '#3B82F6' // blue.500

    // Blue: Unreviewed segments
    if (!tu.ts) {
      return '#3B82F6' // blue.500
    }

    // Reviewed segments - color based on state
    const isOriginal = normalizedArraysEqual(tu.ntgt || [], originalTu.ntgt || [])
    if (isOriginal) {
      return '#86EFAC' // green.300 - Reviewed, unchanged from original
    }

    const isSaved = normalizedArraysEqual(tu.ntgt || [], savedTu.ntgt || [])
    if (isSaved) {
      return '#FACC15' // yellow.400 - Reviewed, changed and saved
    }

    return '#EF4444' // red.500 - Reviewed, changed but not saved
  }, [tusByGuid, originalTusByGuid, savedTusByGuid])

  // Setup keyboard navigation
  useKeyboardNavigation({
    currentPageIndex,
    totalPages: flowData?.pages.length || 0,
    activeSegmentGuid,
    segmentGuids,
    navigatePage,
    setActiveSegmentGuid: handleSetActiveSegmentGuid,
    onBeforeNavigate: handleBeforeNavigate,
  })

  // When navigating to a new page or when jobData loads without flowData, focus on the first segment
  // But don't auto-select when user has explicitly deselected or when only the filter changes
  useEffect(() => {
    const hasSegments = segmentGuids.length > 0
    if (hasSegments && activeSegmentGuid === null && !userDeselected.current) {
      // Use 'editor' source to trigger scroll in screenshot viewer
      handleSetActiveSegmentGuid(segmentGuids[0], 'editor')
    }
  }, [currentPageIndex, flowData, segmentGuids, activeSegmentGuid])

  // Handle case where active segment gets filtered out - deselect instead of auto-selecting
  useEffect(() => {
    if (activeSegmentGuid !== null && !segmentGuids.includes(activeSegmentGuid)) {
      handleSetActiveSegmentGuid(null)
    }
  }, [segmentGuids, activeSegmentGuid])

  // Reset page index when new flow data is loaded
  useEffect(() => {
    setCurrentPageIndex(0)
    userDeselected.current = false // Reset on new data
    setActiveSegmentGuid(null)
  }, [flowData])
  
  if (!jobData || !originalJobData || !savedJobData) {
    return (
      <GlassBox p={6} height="100%" display="flex" alignItems="center" justifyContent="center">
        <Text color="gray.600" textAlign="center" py={20}>
          Load a .lqaboss file to view and edit
        </Text>
      </GlassBox>
    )
  }
  
  return (
    <>
      {flowData ? (
        // Two-pane layout when flowData exists
        <ResizablePane
          key={flowData.pages[0]?.imageFile || 'default'}
          controlledLeftWidth={optimalLeftWidth}
        >
          {/* Screenshot Section */}
          <GlassBox 
            p={0} 
            height="100%"
            position="relative"
            display="flex"
            flexDirection="column"
          >
            {pageImages ? (
              // Render ALL pages upfront, show/hide with CSS for instant navigation
              <Box position="relative" height="100%" width="100%">
                {flowData.pages.map((page, idx) => (
                  <Box
                    key={page.imageFile}
                    display={idx === currentPageIndex ? 'block' : 'none'}
                    height="100%"
                    width="100%"
                  >
                    <ScreenshotViewer
                      page={page}
                      imageUrl={pageImages.get(page.imageFile)}
                      activeSegmentGuid={idx === currentPageIndex ? activeSegmentGuid : null}
                      onSegmentClick={handleScreenshotSegmentClick}
                      shouldScrollToSegment={idx === currentPageIndex && segmentClickSource.current === 'editor'}
                      currentPageIndex={currentPageIndex}
                      totalPages={flowData.pages.length}
                      onNavigatePage={navigatePage}
                      onMarkAllVisibleAsReviewed={handleMarkAllVisibleAsReviewed}
                      getSegmentColor={getSegmentColor}
                    />
                  </Box>
                ))}
              </Box>
            ) : (
              <Text color="gray.600" textAlign="center" py={20}>
                No screenshot available for this page
              </Text>
            )}
          </GlassBox>

          {/* Editor Section */}
          <GlassBox p={4} pt={2} height="100%" overflow="hidden" minWidth={0} maxW="100%" display="flex" flexDirection="column">
            <HStack justify="space-between" align="center" mb={2} flexShrink={0}>
              <Heading size="md" color="gray.700">
                Editable Text Segments
              </Heading>
              <TranslationFilterControls
                showOnlyNonReviewed={showOnlyNonReviewed}
                onShowOnlyNonReviewedChange={setShowOnlyNonReviewed}
                filterText={filterText}
                onFilterTextChange={setFilterText}
                searchableFields={searchableFields}
                onSearchableFieldsChange={setSearchableFields}
                onFilterFocus={() => handleSetActiveSegmentGuid(null)}
              />
            </HStack>
            <Box flex="1" minHeight={0}>
              <TextSegmentEditor
                page={currentPage || null}
                jobData={filteredJobData || jobData}
                originalJobData={originalJobData}
                savedJobData={savedJobData}
                onTranslationUnitChange={onTranslationUnitChange}
                onCandidateSelect={onCandidateSelect}
                activeSegmentGuid={activeSegmentGuid}
                onSegmentFocus={handleEditorSegmentFocus}
                qualityModel={qualityModel}
                onReviewToggle={onReviewToggle}
                onSegmentFocusStart={onSegmentFocusStart}
                onSegmentFocusEnd={onSegmentFocusEnd}
                onSegmentEdited={onSegmentEdited}
              />
            </Box>
          </GlassBox>
        </ResizablePane>
      ) : (
        // Single-pane layout when no flowData (screenshot-less mode)
        <GlassBox p={6} height="100%" overflow="hidden" minWidth={0} maxW="100%" boxSizing="border-box" display="flex" flexDirection="column">
          <HStack justify="space-between" align="center" mb={4} flexShrink={0}>
            <Heading size="md" color="gray.700">
              Editable Translation Units
            </Heading>
            <TranslationFilterControls
              showOnlyNonReviewed={showOnlyNonReviewed}
              onShowOnlyNonReviewedChange={setShowOnlyNonReviewed}
              filterText={filterText}
              onFilterTextChange={setFilterText}
              searchableFields={searchableFields}
              onSearchableFieldsChange={setSearchableFields}
              onFilterFocus={() => handleSetActiveSegmentGuid(null)}
            />
          </HStack>
          <Box flex="1" minHeight={0}>
            <TextSegmentEditor
              page={null}
              jobData={filteredJobData || jobData}
              originalJobData={originalJobData}
              savedJobData={savedJobData}
              onTranslationUnitChange={onTranslationUnitChange}
              onCandidateSelect={onCandidateSelect}
              activeSegmentGuid={activeSegmentGuid}
              onSegmentFocus={handleEditorSegmentFocus}
              qualityModel={qualityModel}
              onReviewToggle={onReviewToggle}
              onSegmentFocusStart={onSegmentFocusStart}
              onSegmentFocusEnd={onSegmentFocusEnd}
              onSegmentEdited={onSegmentEdited}
            />
          </Box>
        </GlassBox>
      )}
      
      {/* Info Modal */}
      {jobData && (jobData.sourceLang || jobData.targetLang || jobData.instructions || jobData.jobGuid || jobData.updatedAt || sourceInfo || ter !== null || ept !== null) && (
        <InfoModal
          isOpen={isInfoModalOpen}
          onClose={() => setIsInfoModalOpen(false)}
          instructions={jobData.instructions}
          sourceLang={jobData.sourceLang}
          targetLang={jobData.targetLang}
          jobName={jobData.jobName}
          jobGuid={jobData.jobGuid}
          updatedAt={jobData.updatedAt}
          sourceInfo={sourceInfo}
          ter={ter}
          ept={ept}
          segmentWordCounts={segmentWordCounts}
          qualityModelName={qualityModel?.name}
          qualityModelVersion={qualityModel?.version}
          loadingProgress={loadingProgress}
        />
      )}
    </>
  )
}) 