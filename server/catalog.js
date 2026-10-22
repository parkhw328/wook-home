export const VERSION = '0.1.0-dev';

const unavailableCapabilities = {
  createSession: false,
  observeSession: false,
  resumeSession: false,
  interrupt: false,
  changeModel: false,
};

export const providers = [
  {
    id: 'demo',
    name: '체험 직원',
    available: true,
    kind: 'demo',
    reason: '실제 AI 호출 없이 질문·답변·승인 흐름을 체험합니다.',
    models: ['local-demo'],
    reasoningEfforts: ['none'],
    capabilities: {
      createSession: true,
      observeSession: true,
      resumeSession: true,
      interrupt: true,
      changeModel: false,
    },
  },
  ...[
    ['openai', 'OpenAI', 'https://chatgpt.com/'],
    ['claude', 'Claude', 'https://claude.ai/'],
    ['gemini', 'Google Gemini', 'https://gemini.google.com/'],
    ['meta', 'Meta Muse', 'https://www.meta.ai/'],
  ].map(([id, name, webUrl]) => ({
    id,
    name,
    webUrl,
    guideUrl: 'https://github.com/parkhw328/wook-home/wiki/Providers',
    available: false,
    kind: 'external',
    reason: id === 'openai' ? 'Codex 대화를 연결하면 모델·추론 강도 선택과 지시 전송을 사용할 수 있습니다. 새 AI 실행은 준비 중입니다.'
      : '감지한 CLI·웹을 직원에 연결할 수 있습니다. 새 AI 실행과 모델 변경은 준비 중입니다.',
    models: [],
    reasoningEfforts: [],
    capabilities: { ...unavailableCapabilities },
  })),
];

export const programs = [
  { name: 'StackQueue Blog', description: 'StackQueue의 네이버 블로그를 방문해 보세요.', url: 'https://blog.naver.com/stack-queue' },
  { name: 'wShell', description: 'SSH 접속과 SFTP 파일 전송을 한 창에서 관리하세요.', url: 'https://github.com/parkhw328/wook-shell' },
  { name: 'wPost', description: 'API 요청과 응답을 확인하고 컬렉션으로 관리하세요.', url: 'https://github.com/parkhw328/wook-post' },
  { name: 'wText', description: '문서를 탭으로 편집하고 파일과 텍스트의 차이를 비교하세요.', url: 'https://github.com/parkhw328/wook-text' },
];
