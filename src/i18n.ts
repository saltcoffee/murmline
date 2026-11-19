const en = {
  capture: 'Capture a thought', input: 'Thought', placeholder: 'What’s on your mind?',
  post: 'Post', posting: 'Posting…', empty: 'No thoughts yet. Write your first one.',
  earlier: 'Load earlier thoughts', more: 'More', remove: 'Delete', cancel: 'Cancel',
  confirm: 'Delete this thought?', deleting: 'Deleting…', retry: 'Retry', loading: 'Loading thoughts…',
  loadError: 'Could not load thoughts.', readError: 'Could not read this thought.',
  saveError: 'Could not post. Please try again.', deleteError: 'Could not delete. Please try again.',
  changed: 'This thought has changed. Review it before deleting.',
  gone: 'This thought was moved, removed, or is no longer a Murmline post.',
  today: 'Today', yesterday: 'Yesterday', openError: 'Could not open Murmline.',
  invalid: 'Invalid thought file', occupied: 'Storage path is in use',
  over: (n: number) => n + (n === 1 ? ' character over the limit' : ' characters over the limit'),
  quote: 'Quote', cancelQuote: 'Cancel quote', quoteOf: (label: string) => 'Quoting · ' + label,
  copyText: 'Copy text', copiedText: 'Copied text',
  copyLink: 'Copy link', copiedLink: 'Copied link', copyError: 'Could not copy. Please try again.',
  openSource: 'Open source file',
  quoteDeleted: 'The original thought was deleted or is unavailable.',
  quoteFailed: 'Could not read the original thought.',
  searchPlaceholder: 'Search thoughts or #tags…', clearSearch: 'Clear search',
  searching: 'Searching…', noResults: 'No matching thoughts.',
  searchPartial: (n: number) => n + (n === 1 ? ' record could not be read.' : ' records could not be read.'),
};
export type Messages = typeof en;
const zh: Messages = {
  capture: '记录想法', input: '想法正文', placeholder: '此刻在想什么？',
  post: '发布', posting: '发布中…', empty: '还没有想法，写下第一条吧。',
  earlier: '加载更早记录', more: '更多', remove: '删除', cancel: '取消',
  confirm: '删除这条想法？', deleting: '删除中…', retry: '重试', loading: '正在读取记录…',
  loadError: '读取失败。', readError: '这条记录读取失败。',
  saveError: '发布失败，请重试。', deleteError: '删除失败，请重试。',
  changed: '这条想法已更改，请查看新正文后再确认。',
  gone: '记录已移动、已移除或已不属于 Murmline。',
  today: '今天', yesterday: '昨天', openError: '无法打开 Murmline。',
  invalid: '记录文件无效', occupied: '存储路径已被占用',
  over: n => '已超出 ' + n + ' 字',
  quote: '引用', cancelQuote: '取消引用', quoteOf: label => '正在引用 · ' + label,
  copyText: '复制正文', copiedText: '已复制正文',
  copyLink: '复制笔记链接', copiedLink: '已复制链接', copyError: '复制失败，请重试。',
  openSource: '打开源文件',
  quoteDeleted: '原想法已删除或不可用',
  quoteFailed: '原想法读取失败',
  searchPlaceholder: '搜索想法或 #标签…', clearSearch: '清除搜索',
  searching: '正在搜索…', noResults: '没有找到匹配的想法',
  searchPartial: n => '有 ' + n + ' 条记录读取失败',
};
export function language(code: string) {
  return /^zh(?:[-_]|$)/i.test(code)
    ? { locale: 'zh-CN', t: zh }
    : { locale: 'en', t: en };
}
export type Language = ReturnType<typeof language>;
