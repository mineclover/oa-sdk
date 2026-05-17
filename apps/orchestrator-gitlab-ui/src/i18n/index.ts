export type Locale = 'ko' | 'en'

export type TranslationKey =
  | 'app.brand'
  | 'app.context'
  | 'app.language.ko'
  | 'app.language.en'
  | 'route.overview.title'
  | 'route.overview.description'
  | 'route.issues.title'
  | 'route.issues.description'
  | 'route.context.title'
  | 'route.context.description'
  | 'route.docs.title'
  | 'route.docs.description'
  | 'route.settings.title'
  | 'route.settings.description'
  | 'action.overview'
  | 'action.issues'
  | 'action.context'
  | 'action.docs'
  | 'action.settings'
  | 'summary.activePipelines'
  | 'summary.mrsPending'
  | 'summary.blockedPipelines'
  | 'summary.requiresAction'
  | 'summary.successRate'
  | 'summary.rollingTarget'
  | 'summary.leadTime'
  | 'summary.requestToDone'
  | 'summary.pipelineStates'
  | 'issues.openWorkItems'
  | 'issues.activeIntake'
  | 'issues.inExecution'
  | 'issues.operatorsHandling'
  | 'issues.queued'
  | 'issues.readyForPickup'
  | 'issues.blocked'
  | 'issues.needsApproval'
  | 'issues.awaitingReview'
  | 'issues.humanCheckpoint'
  | 'issues.workIntake'
  | 'issues.workStaging'
  | 'issues.issueQueue'
  | 'issues.project'
  | 'issues.owner'
  | 'issues.estimate'
  | 'issues.remaining'
  | 'issues.queuePosition'
  | 'issues.tasksTitle'
  | 'issues.tasksDescription'
  | 'issues.taskAddPlaceholder'
  | 'issues.taskAdd'
  | 'issues.taskRefresh'
  | 'issues.taskDone'
  | 'issues.taskUnavailable'
  | 'issues.taskDelete'
  | 'issues.backToIssues'
  | 'issues.notFoundTitle'
  | 'issues.notFoundDescription'
  | 'context.searchTitle'
  | 'context.searchDescription'
  | 'context.query'
  | 'context.placeholder'
  | 'context.confidenceBaseline'
  | 'context.healthyIndex'
  | 'context.degradedIndex'
  | 'context.coverage'
  | 'context.coverageDescription'
  | 'context.results'
  | 'context.source'
  | 'context.confidence'
  | 'context.updated'
  | 'docs.wiki'
  | 'docs.repository'
  | 'docs.release'
  | 'docs.lastSynced'
  | 'docs.project'
  | 'docs.path'
  | 'docs.owner'
  | 'docs.referenceLookup'
  | 'docs.referenceDescription'
  | 'docs.workspaceTitle'
  | 'docs.workspaceDescription'
  | 'docs.openEditor'
  | 'docs.openFirstEditor'
  | 'docs.editorRoute'
  | 'docs.editorRouteHint'
  | 'docs.autosaveLocation'
  | 'docs.gitlabDestination'
  | 'docs.requestDestination'
  | 'docs.backToDocs'
  | 'docs.notFoundTitle'
  | 'docs.notFoundDescription'
  | 'docs.editorTitle'
  | 'docs.editorDescription'
  | 'docs.editorPlaceholder'
  | 'docs.editorLoading'
  | 'docs.editorReset'
  | 'docs.editorSaved'
  | 'docs.editorH1'
  | 'docs.editorH2'
  | 'docs.editorH3'
  | 'docs.editorH4'
  | 'docs.editorH5'
  | 'docs.editorH6'
  | 'docs.editorQuote'
  | 'docs.editorBold'
  | 'docs.editorItalic'
  | 'docs.editorCode'
  | 'docs.editorStrike'
  | 'docs.editorLink'
  | 'docs.editorBulletList'
  | 'docs.editorNumberedList'
  | 'docs.editorTodoList'
  | 'docs.editorIndent'
  | 'docs.editorOutdent'
  | 'docs.snippetIssueReference'
  | 'docs.snippetMergeRequestReference'
  | 'docs.snippetLabelReference'
  | 'docs.snippetMilestoneReference'
  | 'docs.snippetTable'
  | 'docs.snippetCodeFence'
  | 'docs.snippetMermaid'
  | 'docs.snippetMath'
  | 'docs.snippetToc'
  | 'docs.snippetAlert'
  | 'docs.snippetImage'
  | 'docs.snippetSearchPlaceholder'
  | 'docs.snippetSearch'
  | 'docs.snippetManual'
  | 'docs.snippetNoResults'
  | 'docs.snippetUnavailable'
  | 'docs.markdownPreviewTitle'
  | 'docs.markdownPreviewDescription'
  | 'docs.rawMarkdownTitle'
  | 'docs.rawMarkdownDescription'
  | 'docs.rawMarkdownPayload'
  | 'docs.saveTarget'
  | 'docs.targetWiki'
  | 'docs.targetRepository'
  | 'docs.targetRelease'
  | 'docs.dryRunTitle'
  | 'docs.dryRunDescription'
  | 'docs.dryRunProject'
  | 'docs.dryRunPath'
  | 'docs.dryRunPayload'
  | 'docs.dryRunMethod'
  | 'docs.dryRunEndpoint'
  | 'docs.dryRunBody'
  | 'docs.saveMode'
  | 'docs.modeCreate'
  | 'docs.modeUpdate'
  | 'docs.branch'
  | 'docs.validateSave'
  | 'docs.executeSave'
  | 'docs.saveSaving'
  | 'docs.saveSucceeded'
  | 'docs.saveFailed'
  | 'docs.saveResult'
  | 'settings.tokenInventory'
  | 'settings.scope'
  | 'settings.expires'
  | 'settings.capabilityOwners'
  | 'settings.capabilityOwnerDescription'
  | 'panel.operationalWarnings'
  | 'panel.capabilities'
  | 'panel.dryRun'
  | 'panel.dryRunDescription'
  | 'panel.owner'
  | 'time.minutesAgo'
  | 'time.hoursMinutesAgo'
  | 'empty.notAvailable'

export const locales: readonly Locale[] = ['ko', 'en']

const translations: Record<Locale, Record<TranslationKey, string>> = {
  ko: {
    'app.brand': '워크 허브',
    'app.context': 'GitLab 기반 프로젝트 컨텍스트',
    'app.language.ko': '한국어',
    'app.language.en': 'English',
    'route.overview.title': '개요',
    'route.overview.description': '서비스 상태, 진행 중인 작업, GitLab 이슈 흐름을 한 화면에서 확인합니다.',
    'route.issues.title': '이슈',
    'route.issues.description': 'Linear를 대체하는 GitLab 이슈 접수, 큐, 담당자, 실행 상태 화면입니다.',
    'route.context.title': '컨텍스트',
    'route.context.description': '이슈, 머지 리퀘스트, 문서, 런북에서 프로젝트 컨텍스트를 검색합니다.',
    'route.docs.title': '문서',
    'route.docs.description': 'GitLab Wiki, 저장소 문서, 릴리즈 문서 생명주기를 관리합니다.',
    'route.settings.title': '설정',
    'route.settings.description': '기능 지원 범위, 토큰 준비 상태, dry-run 실행 의미를 관리합니다.',
    'action.overview': '알림 확인',
    'action.issues': '새 접수 열기',
    'action.context': '프로젝트 스캔',
    'action.docs': '문서 인덱스 동기화',
    'action.settings': '정책 편집',
    'summary.activePipelines': '활성 파이프라인',
    'summary.mrsPending': 'MR 대기',
    'summary.blockedPipelines': '차단된 파이프라인',
    'summary.requiresAction': '운영자 조치 필요',
    'summary.successRate': '성공률 (24h)',
    'summary.rollingTarget': '최근 24시간 기준',
    'summary.leadTime': '리드 타임',
    'summary.requestToDone': '요청부터 완료까지',
    'summary.pipelineStates': '파이프라인 상태',
    'issues.openWorkItems': '열린 작업',
    'issues.activeIntake': '운영 접수에서 활성',
    'issues.inExecution': '실행 중',
    'issues.operatorsHandling': '담당자가 처리 중',
    'issues.queued': '대기열',
    'issues.readyForPickup': '바로 처리 가능',
    'issues.blocked': '차단됨',
    'issues.needsApproval': '의존성 또는 승인 필요',
    'issues.awaitingReview': '리뷰 대기',
    'issues.humanCheckpoint': '인계 전 사람 검토 지점',
    'issues.workIntake': 'Linear 스타일 작업 접수',
    'issues.workStaging': '작업 접수 스테이징',
    'issues.issueQueue': '이슈 큐',
    'issues.project': '프로젝트',
    'issues.owner': '담당자',
    'issues.estimate': '예상',
    'issues.remaining': '남은 시간',
    'issues.queuePosition': '큐 순번',
    'issues.tasksTitle': '이슈 작업',
    'issues.tasksDescription': 'GitLab 이슈 설명의 task list를 조회하고 수정합니다.',
    'issues.taskAddPlaceholder': '새 task 입력',
    'issues.taskAdd': '추가',
    'issues.taskRefresh': '새로고침',
    'issues.taskDone': '완료',
    'issues.taskUnavailable': '이슈 task API에 연결할 수 없음',
    'issues.taskDelete': '삭제',
    'issues.backToIssues': '이슈 목록으로',
    'issues.notFoundTitle': '이슈를 찾을 수 없음',
    'issues.notFoundDescription': '요청한 이슈가 현재 작업 큐에 없습니다.',
    'context.searchTitle': '프로젝트 컨텍스트 검색',
    'context.searchDescription': '이슈, 스펙, 런북, 머지 리퀘스트를 함께 검색합니다.',
    'context.query': '검색어',
    'context.placeholder': '릴리즈 정책 네임스페이스',
    'context.confidenceBaseline': '신뢰도 기준',
    'context.healthyIndex': '정상 인덱스',
    'context.degradedIndex': '인덱스 저하',
    'context.coverage': '프로젝트 컨텍스트 커버리지',
    'context.coverageDescription': '운영 런북 탐색의 주요 워크스페이스입니다.',
    'context.results': '컨텍스트 검색 결과',
    'context.source': '출처',
    'context.confidence': '신뢰도',
    'context.updated': '업데이트',
    'docs.wiki': 'GitLab Wiki',
    'docs.repository': '저장소 문서',
    'docs.release': '릴리즈 문서',
    'docs.lastSynced': '17분 전 동기화',
    'docs.project': '프로젝트',
    'docs.path': '경로',
    'docs.owner': '담당자',
    'docs.referenceLookup': '참조 조회',
    'docs.referenceDescription': '실시간 컨텍스트 검색에서 발견한 관련 문서입니다.',
    'docs.workspaceTitle': '문서 편집 워크스페이스',
    'docs.workspaceDescription': '편집할 GitLab 문서를 선택하면 문서별 초안과 자동 저장 공간이 분리됩니다.',
    'docs.openEditor': '편집 열기',
    'docs.openFirstEditor': '첫 문서 편집 열기',
    'docs.editorRoute': '에디터 경로',
    'docs.editorRouteHint': '바로 진입 가능한 에디터 경로',
    'docs.autosaveLocation': '로컬 자동 저장 위치',
    'docs.gitlabDestination': 'GitLab 저장 목적지',
    'docs.requestDestination': '요청 저장 목적지',
    'docs.backToDocs': '문서 목록으로',
    'docs.notFoundTitle': '문서를 찾을 수 없음',
    'docs.notFoundDescription': '요청한 문서 경로가 현재 GitLab 문서 인덱스에 없습니다.',
    'docs.editorTitle': '릴리즈 문서 에디터',
    'docs.editorDescription': 'Plate 기반으로 Wiki, 저장소 문서, 릴리즈 노트를 같은 편집 모델에서 작성합니다.',
    'docs.editorPlaceholder': '릴리즈 문서 내용을 입력하세요...',
    'docs.editorLoading': '에디터를 불러오는 중입니다...',
    'docs.editorReset': '초기화',
    'docs.editorSaved': '로컬 자동 저장',
    'docs.editorH1': 'H1',
    'docs.editorH2': 'H2',
    'docs.editorH3': 'H3',
    'docs.editorH4': 'H4',
    'docs.editorH5': 'H5',
    'docs.editorH6': 'H6',
    'docs.editorQuote': '인용',
    'docs.editorBold': 'B',
    'docs.editorItalic': 'I',
    'docs.editorCode': '코드',
    'docs.editorStrike': '취소선',
    'docs.editorLink': '링크',
    'docs.editorBulletList': '불릿',
    'docs.editorNumberedList': '번호',
    'docs.editorTodoList': '체크리스트',
    'docs.editorIndent': '들여쓰기',
    'docs.editorOutdent': '내어쓰기',
    'docs.snippetIssueReference': '이슈 참조',
    'docs.snippetMergeRequestReference': 'MR 참조',
    'docs.snippetLabelReference': '라벨 참조',
    'docs.snippetMilestoneReference': '마일스톤',
    'docs.snippetTable': '테이블',
    'docs.snippetCodeFence': '코드블록',
    'docs.snippetMermaid': 'Mermaid',
    'docs.snippetMath': '수식',
    'docs.snippetToc': '목차',
    'docs.snippetAlert': '알림',
    'docs.snippetImage': '이미지',
    'docs.snippetSearchPlaceholder': '제목 또는 설명 검색',
    'docs.snippetSearch': '검색',
    'docs.snippetManual': '직접 입력',
    'docs.snippetNoResults': '검색 결과 없음',
    'docs.snippetUnavailable': 'GitLab 검색 API에 연결할 수 없음',
    'docs.markdownPreviewTitle': 'GitLab Markdown 미리보기',
    'docs.markdownPreviewDescription': '에디터 내용은 GitLab Markdown으로 직렬화한 뒤 저장 API payload에 사용합니다.',
    'docs.rawMarkdownTitle': 'Raw Markdown',
    'docs.rawMarkdownDescription': 'Notion-like 에디터에서 작성한 구조화 문서가 실제로 저장될 Markdown 원문입니다.',
    'docs.rawMarkdownPayload': 'Raw Markdown payload',
    'docs.saveTarget': '저장 대상',
    'docs.targetWiki': 'Wiki 페이지',
    'docs.targetRepository': '저장소 파일',
    'docs.targetRelease': '릴리즈 노트',
    'docs.dryRunTitle': 'GitLab 저장 dry-run',
    'docs.dryRunDescription': '아직 GitLab에 쓰지 않고, 저장 API로 보낼 대상과 Markdown payload만 검증합니다.',
    'docs.dryRunProject': '프로젝트',
    'docs.dryRunPath': '경로',
    'docs.dryRunPayload': 'Markdown payload',
    'docs.dryRunMethod': '메서드',
    'docs.dryRunEndpoint': '엔드포인트',
    'docs.dryRunBody': '요청 body',
    'docs.saveMode': '저장 방식',
    'docs.modeCreate': '생성',
    'docs.modeUpdate': '수정',
    'docs.branch': '브랜치',
    'docs.validateSave': 'Dry-run 검증',
    'docs.executeSave': 'GitLab 저장',
    'docs.saveSaving': '저장 API 호출 중',
    'docs.saveSucceeded': '저장 API 호출 완료',
    'docs.saveFailed': '저장 API 호출 실패',
    'docs.saveResult': '저장 API 응답',
    'settings.tokenInventory': '토큰 인벤토리',
    'settings.scope': '범위',
    'settings.expires': '만료',
    'settings.capabilityOwners': '기능 담당자',
    'settings.capabilityOwnerDescription': '오케스트레이터 런타임이 추적하는 담당 기능입니다.',
    'panel.operationalWarnings': '운영 경고',
    'panel.capabilities': '기능 지원 범위',
    'panel.dryRun': 'Dry-run 의미',
    'panel.dryRunDescription': '실행 전 변경 효과와 격리 수준을 확인합니다.',
    'panel.owner': '담당',
    'time.minutesAgo': '{minutes}분 전',
    'time.hoursMinutesAgo': '{hours}시간 {minutes}분 전',
    'empty.notAvailable': '없음',
  },
  en: {
    'app.brand': 'Work Hub',
    'app.context': 'GitLab-native project context',
    'app.language.ko': '한국어',
    'app.language.en': 'English',
    'route.overview.title': 'Overview',
    'route.overview.description': 'Monitor service health, active work, and GitLab issue flow at a glance.',
    'route.issues.title': 'Issues',
    'route.issues.description': 'Linear-style GitLab issue intake, queue, ownership, and execution status.',
    'route.context.title': 'Context',
    'route.context.description': 'Search project context across issues, merge requests, docs, and runbooks.',
    'route.docs.title': 'Docs',
    'route.docs.description': 'Manage GitLab Wiki, repository docs, and release document lifecycle.',
    'route.settings.title': 'Settings',
    'route.settings.description': 'Manage capabilities, token readiness, and dry-run execution semantics.',
    'action.overview': 'Acknowledge alerts',
    'action.issues': 'Open new intake',
    'action.context': 'Run project scan',
    'action.docs': 'Sync doc indexes',
    'action.settings': 'Edit policies',
    'summary.activePipelines': 'Active pipelines',
    'summary.mrsPending': 'MRs pending',
    'summary.blockedPipelines': 'Blocked pipelines',
    'summary.requiresAction': 'Requires operator action',
    'summary.successRate': 'Success rate (24h)',
    'summary.rollingTarget': 'Rolling 24h target',
    'summary.leadTime': 'Lead time',
    'summary.requestToDone': 'Request to done',
    'summary.pipelineStates': 'Pipeline states',
    'issues.openWorkItems': 'Open work items',
    'issues.activeIntake': 'Active in operator intake',
    'issues.inExecution': 'In execution',
    'issues.operatorsHandling': 'Operators actively handling',
    'issues.queued': 'Queued',
    'issues.readyForPickup': 'Ready for pickup',
    'issues.blocked': 'Blocked',
    'issues.needsApproval': 'Needs dependency or approval',
    'issues.awaitingReview': 'Awaiting review',
    'issues.humanCheckpoint': 'Human checkpoint before handoff',
    'issues.workIntake': 'Linear-style work intake',
    'issues.workStaging': 'Work intake staging',
    'issues.issueQueue': 'Issue Queue',
    'issues.project': 'Project',
    'issues.owner': 'Owner',
    'issues.estimate': 'Estimate',
    'issues.remaining': 'Remaining',
    'issues.queuePosition': 'in queue',
    'issues.tasksTitle': 'Issue Tasks',
    'issues.tasksDescription': 'Read and update the task list stored in the GitLab issue description.',
    'issues.taskAddPlaceholder': 'Add a task',
    'issues.taskAdd': 'Add',
    'issues.taskRefresh': 'Refresh',
    'issues.taskDone': 'done',
    'issues.taskUnavailable': 'Issue task API unavailable',
    'issues.taskDelete': 'Delete',
    'issues.backToIssues': 'Back to issues',
    'issues.notFoundTitle': 'Issue not found',
    'issues.notFoundDescription': 'The requested issue is not in the current work queue.',
    'context.searchTitle': 'Project context search',
    'context.searchDescription': 'Search across issues, specs, runbooks, and merge requests.',
    'context.query': 'Query',
    'context.placeholder': 'release policy namespace',
    'context.confidenceBaseline': 'Confidence baseline',
    'context.healthyIndex': 'healthy index',
    'context.degradedIndex': 'index degraded',
    'context.coverage': 'Project context coverage',
    'context.coverageDescription': 'Top-scoped workspace for operational runbook discovery.',
    'context.results': 'Context Search Results',
    'context.source': 'Source',
    'context.confidence': 'Confidence',
    'context.updated': 'Updated',
    'docs.wiki': 'GitLab Wiki',
    'docs.repository': 'Repository Docs',
    'docs.release': 'Release Docs',
    'docs.lastSynced': 'Last synced 17m ago',
    'docs.project': 'Project',
    'docs.path': 'Path',
    'docs.owner': 'Owner',
    'docs.referenceLookup': 'Reference lookup',
    'docs.referenceDescription': 'Related docs discovered from live context search.',
    'docs.workspaceTitle': 'Document editing workspace',
    'docs.workspaceDescription': 'Choose a GitLab document to edit with document-specific drafts and autosave storage.',
    'docs.openEditor': 'Open editor',
    'docs.openFirstEditor': 'Open first editor',
    'docs.editorRoute': 'Editor route',
    'docs.editorRouteHint': 'Direct editor route',
    'docs.autosaveLocation': 'Local autosave location',
    'docs.gitlabDestination': 'GitLab save destination',
    'docs.requestDestination': 'Request save destination',
    'docs.backToDocs': 'Back to docs',
    'docs.notFoundTitle': 'Document not found',
    'docs.notFoundDescription': 'The requested document path is not in the current GitLab document index.',
    'docs.editorTitle': 'Release document editor',
    'docs.editorDescription': 'Author Wiki pages, repository docs, and release notes on one Plate editing model.',
    'docs.editorPlaceholder': 'Draft release documentation...',
    'docs.editorLoading': 'Loading editor...',
    'docs.editorReset': 'Reset',
    'docs.editorSaved': 'Local autosave',
    'docs.editorH1': 'H1',
    'docs.editorH2': 'H2',
    'docs.editorH3': 'H3',
    'docs.editorH4': 'H4',
    'docs.editorH5': 'H5',
    'docs.editorH6': 'H6',
    'docs.editorQuote': 'Quote',
    'docs.editorBold': 'B',
    'docs.editorItalic': 'I',
    'docs.editorCode': 'Code',
    'docs.editorStrike': 'Strike',
    'docs.editorLink': 'Link',
    'docs.editorBulletList': 'Bullet',
    'docs.editorNumberedList': 'Numbered',
    'docs.editorTodoList': 'Todo',
    'docs.editorIndent': 'Indent',
    'docs.editorOutdent': 'Outdent',
    'docs.snippetIssueReference': 'Issue ref',
    'docs.snippetMergeRequestReference': 'MR ref',
    'docs.snippetLabelReference': 'Label ref',
    'docs.snippetMilestoneReference': 'Milestone',
    'docs.snippetTable': 'Table',
    'docs.snippetCodeFence': 'Code block',
    'docs.snippetMermaid': 'Mermaid',
    'docs.snippetMath': 'Math',
    'docs.snippetToc': 'TOC',
    'docs.snippetAlert': 'Alert',
    'docs.snippetImage': 'Image',
    'docs.snippetSearchPlaceholder': 'Search title or description',
    'docs.snippetSearch': 'Search',
    'docs.snippetManual': 'Manual',
    'docs.snippetNoResults': 'No results',
    'docs.snippetUnavailable': 'GitLab search API unavailable',
    'docs.markdownPreviewTitle': 'GitLab Markdown preview',
    'docs.markdownPreviewDescription': 'Editor content is serialized to GitLab Markdown before it becomes a save API payload.',
    'docs.rawMarkdownTitle': 'Raw Markdown',
    'docs.rawMarkdownDescription': 'The Markdown source that will be saved from the Notion-like structured editor.',
    'docs.rawMarkdownPayload': 'Raw Markdown payload',
    'docs.saveTarget': 'Save target',
    'docs.targetWiki': 'Wiki page',
    'docs.targetRepository': 'Repository file',
    'docs.targetRelease': 'Release note',
    'docs.dryRunTitle': 'GitLab save dry-run',
    'docs.dryRunDescription': 'No GitLab write is performed yet; this validates the destination and Markdown payload for the save API.',
    'docs.dryRunProject': 'Project',
    'docs.dryRunPath': 'Path',
    'docs.dryRunPayload': 'Markdown payload',
    'docs.dryRunMethod': 'Method',
    'docs.dryRunEndpoint': 'Endpoint',
    'docs.dryRunBody': 'Request body',
    'docs.saveMode': 'Save mode',
    'docs.modeCreate': 'Create',
    'docs.modeUpdate': 'Update',
    'docs.branch': 'Branch',
    'docs.validateSave': 'Validate dry-run',
    'docs.executeSave': 'Save to GitLab',
    'docs.saveSaving': 'Calling save API',
    'docs.saveSucceeded': 'Save API completed',
    'docs.saveFailed': 'Save API failed',
    'docs.saveResult': 'Save API response',
    'settings.tokenInventory': 'Token inventory',
    'settings.scope': 'Scope',
    'settings.expires': 'Expires',
    'settings.capabilityOwners': 'Capability owners',
    'settings.capabilityOwnerDescription': 'Owned capabilities tracked by orchestrator runtime.',
    'panel.operationalWarnings': 'Operational Warnings',
    'panel.capabilities': 'Capabilities',
    'panel.dryRun': 'Dry-run semantics',
    'panel.dryRunDescription': 'Review mutation effects and isolation level before execution.',
    'panel.owner': 'Owner',
    'time.minutesAgo': '{minutes}m ago',
    'time.hoursMinutesAgo': '{hours}h {minutes}m ago',
    'empty.notAvailable': 'N/A',
  },
}

export function normalizeLocale(value: string | null | undefined): Locale {
  return value?.toLowerCase().startsWith('ko') ? 'ko' : 'en'
}

export function translate(
  locale: Locale,
  key: TranslationKey,
  params: Readonly<Record<string, string | number>> = {},
): string {
  let value = translations[locale][key]
  for (const [paramKey, paramValue] of Object.entries(params)) {
    value = value.replaceAll(`{${paramKey}}`, String(paramValue))
  }
  return value
}
