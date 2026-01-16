import { useMemo, useState } from 'react';
import {
  ClockIcon,
  MagnifyingGlassIcon,
  Cog6ToothIcon,
  HomeIcon,
  SparklesIcon,
  CalendarIcon,
  InboxIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  PlusIcon,
  PhotoIcon
} from '@heroicons/react/24/outline';

// Mock data
const demoThreads = [
  {
    id: 'thread-1',
    title: 'OpenContext 产品改进',
    entries: [
      { id: 'e1', createdAt: '2025-12-23T14:30:00Z', text: '我觉得侧边栏应该把 Idea 和 Space 区分开，但是共享一套视觉语言。', type: 'user' },
      { id: 'e2', createdAt: '2025-12-23T14:32:00Z', text: '同意。这样用户在使用 Idea 捕获碎片灵感时，不会觉得跳戏。我们可以引入轻量级的时间轴连线。', type: 'ai' },
    ]
  },
  {
    id: 'thread-2',
    title: '技术架构思考',
    entries: [
      { id: 'e3', createdAt: '2025-12-23T10:15:00Z', text: '底层存储还是用 Markdown，但是 UI 层做结构化提取。', type: 'user' }
    ]
  }
];

function getRelativeTime(dateStr) {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  
  if (diffMins < 60) return `${diffMins}M AGO`;
  if (diffHours < 24) return `${diffHours}H AGO`;
  return date.toLocaleDateString();
}

export default function IdeaTimelineDemo() {
  const [isIdeasExpanded, setIsIdeasExpanded] = useState(true);
  const [selectedDate, setSelectedDate] = useState('Today');

  const streamEntries = useMemo(() => {
    return demoThreads.flatMap(t => t.entries.map(e => ({ ...e, threadTitle: t.title })))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, []);

  return (
    <div className="flex h-screen bg-white text-[#37352F] dark:bg-slate-950 dark:text-slate-100 font-sans">
      {/* 1. Sidebar */}
      <aside className="w-[260px] flex-shrink-0 bg-[#F7F7F5] border-r border-[#E9E9E7] dark:bg-slate-900 dark:border-slate-800 flex flex-col select-none">
        <div className="h-12 flex items-center px-4 mt-2">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-gray-900 rounded flex items-center justify-center">
              <span className="text-white text-[10px] font-bold">OC</span>
            </div>
            <span className="font-bold text-gray-900">OpenContext</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-2 text-sm text-gray-600 dark:text-slate-300">
          <div className="px-2 mb-4">
            <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#EFEFED] dark:hover:bg-slate-800 rounded-sm cursor-pointer transition-colors font-medium">
              <MagnifyingGlassIcon className="h-4 w-4" strokeWidth={2} />
              <span>搜索文档...</span>
              <span className="ml-auto text-[10px] text-gray-400">⌘ K</span>
            </div>
          </div>

          <div className="mb-2">
            <div 
              className="flex items-center gap-1 px-3 py-1 text-[11px] font-bold text-gray-500 uppercase tracking-wider hover:bg-[#EFEFED] dark:text-slate-400 dark:hover:bg-slate-800 cursor-pointer group"
              onClick={() => setIsIdeasExpanded(!isIdeasExpanded)}
            >
              {isIdeasExpanded ? <ChevronDownIcon className="w-3 h-3"/> : <ChevronRightIcon className="w-3 h-3"/>}
              <span>想法 (Ideas)</span>
              <PlusIcon className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-100" />
            </div>
            
            {isIdeasExpanded && (
              <div className="mt-1">
                {['Today', 'Yesterday', 'Dec 21', 'Dec 20'].map(date => (
                  <div 
                    key={date}
                    onClick={() => setSelectedDate(date)}
                    className={`flex items-center gap-2 px-7 py-1.5 cursor-pointer transition-colors ${
                      selectedDate === date ? 'bg-[#EFEFED] text-gray-900 dark:bg-slate-800 dark:text-slate-100 font-medium' : 'hover:bg-[#EFEFED] dark:hover:bg-slate-800'
                    }`}
                  >
                    <CalendarIcon className="w-4 h-4 text-gray-400" />
                    <span>{date}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4">
            <div className="flex items-center gap-1 px-3 py-1 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
              <ChevronRightIcon className="w-3 h-3"/>
              <span>空间 (Spaces)</span>
            </div>
          </div>
        </div>

        <div className="p-2 border-t border-[#E9E9E7] dark:border-slate-800 space-y-1">
          <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 dark:text-slate-300 hover:bg-[#EFEFED] dark:hover:bg-slate-800 rounded-sm cursor-pointer">
            <Cog6ToothIcon className="h-4 w-4 text-gray-400" />
            <span>系统设置</span>
          </div>
        </div>
      </aside>

      {/* 2. Main Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-white dark:bg-slate-950 overflow-hidden">
        <header className="h-12 flex items-center justify-between px-6 border-b border-gray-50 shrink-0">
          <div className="flex items-center gap-2 text-sm text-gray-400 font-medium">
            <span>ideas</span>
            <span>/</span>
            <span className="text-gray-900 uppercase tracking-wider text-xs">{selectedDate}</span>
          </div>
          <div className="flex items-center gap-4">
             <div className="text-[10px] text-gray-400 bg-gray-50 px-2 py-0.5 rounded border border-gray-100 font-mono font-bold">DEMO VIEW</div>
             <HomeIcon className="w-4 h-4 text-gray-300 cursor-pointer hover:text-gray-600" />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="max-w-2xl mx-auto py-12 px-6">
            
            {/* Capture Area */}
            <div className="mb-16">
              <div className="text-2xl font-medium text-gray-300 mb-6 px-1">What's on your mind?</div>
              <div className="flex items-center gap-4">
                <div className="flex gap-3 text-gray-300">
                  <PhotoIcon className="w-5 h-5 cursor-pointer hover:text-gray-500" />
                  <ClockIcon className="w-5 h-5 cursor-pointer hover:text-gray-500" />
                </div>
                <div className="flex-1" />
                <button className="bg-gray-900 hover:bg-black text-white px-6 py-1.5 rounded-full text-sm font-medium transition-all shadow-md active:scale-95">
                  Post
                </button>
              </div>
            </div>

            {/* Stream */}
            <div className="relative space-y-12">
              {/* Vertical line */}
              <div className="absolute left-[15.5px] top-2 bottom-0 w-[1.5px] bg-gray-100" />

              {streamEntries.map((e) => (
                <div key={e.id} className="relative pl-12 group">
                  {/* The Indicator (Missing Icons Fixed) */}
                  <div className="absolute left-0 top-0.5 w-8 h-8 flex items-center justify-center bg-white z-10">
                    {e.type === 'ai' ? (
                      <SparklesIcon className="w-6 h-6 text-purple-500 fill-purple-50" />
                    ) : (
                      <div className="w-4 h-4 rounded-full bg-gray-300 group-hover:bg-blue-500 transition-colors border-[3px] border-white shadow-sm" />
                    )}
                  </div>

                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className={`text-[16px] leading-relaxed text-gray-800 ${e.type === 'ai' ? 'italic text-gray-500' : ''}`}>
                        {e.text}
                      </div>
                      
                      <div className="mt-2 flex items-center gap-3 text-[11px] font-bold text-gray-300 uppercase tracking-tighter">
                        <span className="hover:text-gray-500 cursor-pointer">{e.threadTitle}</span>
                        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-3 transition-opacity">
                          <span className="text-gray-200">/</span>
                          <button className="text-gray-400 hover:text-blue-500 font-bold">Continue</button>
                          <button className="text-gray-400 hover:text-purple-500 flex items-center gap-0.5 font-bold">
                            <SparklesIcon className="w-3 h-3"/> Reflect
                          </button>
                        </div>
                      </div>
                    </div>
                    
                    <div className="text-[10px] font-mono font-bold text-gray-300 whitespace-nowrap pt-1.5">
                      {getRelativeTime(e.createdAt)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
