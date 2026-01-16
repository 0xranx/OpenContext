import { useMemo, useRef, useEffect, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '../routes';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useDraggable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  FolderIcon,
  DocumentTextIcon,
  ArrowPathIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  PlusIcon,
  FolderPlusIcon,
  MagnifyingGlassIcon,
  Cog6ToothIcon,
  AtSymbolIcon,
  DocumentPlusIcon,
  EllipsisHorizontalIcon,
  PencilIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { useTauriDrag } from '../hooks/useTauriDrag.jsx';
import { Logo } from './Logo';
import IdeaSidebar from './IdeaSidebar';

// Simple dropdown menu for sidebar actions
function SidebarDropdown({ items, children }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        className="p-1 rounded-md hover:bg-gray-200 text-gray-500 hover:text-gray-900"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
      >
        {children}
      </button>
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 bg-white rounded-md shadow-lg border border-gray-200 py-1 z-50 min-w-[140px]">
          {items.map((item, index) => (
            <button
              key={index}
              type="button"
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-100 text-left ${item.className || 'text-gray-700'}`}
              onClick={(e) => {
                e.stopPropagation();
                item.onClick?.();
                setIsOpen(false);
              }}
            >
              {item.icon && <item.icon className={`h-4 w-4 ${item.className?.includes('text-red') ? 'text-red-500' : 'text-gray-500'}`} />}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DraggableSidebarItem({ id, data, disabled = false, children }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data,
    disabled,
  });

  // Don't apply transform - we use DragOverlay for the floating preview instead
  const style = {
    opacity: isDragging ? 0.4 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

function DroppableFolderWrapper({ id, children }) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div ref={setNodeRef} data-droppable="folder" data-is-over={isOver ? '1' : '0'}>
      {typeof children === 'function' ? children({ isOver }) : children}
    </div>
  );
}

function SidebarItem({
  icon: Icon,
  label,
  description,
  isActive,
  onClick,
  onToggle,
  onContextMenu,
  isExpanded,
  hasChildren,
  depth = 0,
  children,
  rightActions,
  isDragOver = false,
}) {
  const itemRef = useRef(null);

  useEffect(() => {
    if (isActive && itemRef.current) {
      itemRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [isActive]);

  return (
    <div ref={itemRef} className="relative">
      {depth > 0 && (
        <div className="absolute top-0 bottom-0 w-px bg-gray-200 dark:bg-zinc-800" style={{ left: `${depth * 12 + 6}px` }} />
      )}
      <div
        className={`
          group flex items-start gap-2 px-3 py-1.5 min-h-[28px] text-sm cursor-pointer select-none transition-colors rounded-sm mx-2 relative
          ${isActive 
            ? 'bg-gray-200 text-gray-900 font-medium dark:bg-zinc-800 dark:text-zinc-100' 
            : 'text-gray-600 hover:bg-gray-100 dark:text-zinc-400 dark:hover:bg-zinc-800'}
          ${isDragOver ? 'ring-2 ring-blue-400 bg-blue-50' : ''}
        `}
        style={{ paddingLeft: `${depth * 12 + 12}px` }}
        onClick={onClick}
        onContextMenu={onContextMenu}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle && onToggle();
          }}
          className={`
            p-0.5 rounded-sm hover:bg-gray-300/50 transition-colors mt-0.5
            ${!hasChildren ? 'opacity-0 pointer-events-none' : 'opacity-100'}
          `}
        >
          {isExpanded ? (
            <ChevronDownIcon className="h-3 w-3 text-gray-400" />
          ) : (
            <ChevronRightIcon className="h-3 w-3 text-gray-400" />
          )}
        </button>

        {Icon && (
          <Icon
            className={`h-4 w-4 shrink-0 mt-0.5 ${isActive ? 'text-gray-700 dark:text-zinc-300' : 'text-gray-400 group-hover:text-gray-500 dark:text-zinc-500'}`}
          />
        )}

        <div className="flex-1 min-w-0 overflow-hidden">
          <div className="truncate leading-5">{label}</div>
          {description && (
            <div className={`text-xs truncate font-normal ${isActive ? 'text-gray-500 dark:text-zinc-400' : 'text-gray-400 dark:text-zinc-500'}`}>
              {description}
            </div>
          )}
        </div>

        {rightActions ? (
          <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {rightActions}
          </div>
        ) : null}
      </div>
      {isExpanded && (
        <div className="relative">
          {hasChildren && (
            <div
              className="absolute top-0 bottom-0 w-px bg-gray-200 dark:bg-zinc-800"
              style={{ left: `${(depth + 1) * 12 + 6}px` }}
            />
          )}
          {children}
        </div>
      )}
    </div>
  );
}

function buildFolderTree(folders) {
  const root = { children: {} };
  (folders || []).forEach((folder) => {
    if (!folder.rel_path) return;
    const parts = folder.rel_path.split('/');
    let current = root;
    parts.forEach((part, index) => {
      if (!current.children[part]) {
        current.children[part] = {
          name: part,
          path: parts.slice(0, index + 1).join('/'),
          children: {},
        };
      }
      current = current.children[part];
    });
  });

  function toArray(node) {
    return Object.values(node.children)
      .map((child) => ({
        ...child,
        children: toArray(child),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  return toArray(root);
}

function FolderTreeRenderer({
  node,
  depth,
  expandedFolders,
  toggleFolder,
  folderDocs,
  loadDoc,
  selectedDoc,
  onContextMenu,
  refreshFolder,
  onCopyFolderCitation,
  onCopyDocCitation,
  onRequestCreatePage,
  onRequestCreateFolder,
  onMoveFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveDoc,
  onEditDocDescription,
  onRenameDoc,
  onDeleteDoc,
}) {
  const { t } = useTranslation();
  const isExpanded = expandedFolders.has(node.path);
  const docs = folderDocs[node.path] || [];
  const folderDropId = `folder-drop:${node.path}`;

  return (
    <DroppableFolderWrapper id={folderDropId}>
      {({ isOver }) => (
        <DraggableSidebarItem id={`folder:${node.path}`} data={{ type: 'folder', path: node.path, name: node.name }}>
          <SidebarItem
            key={node.path}
            label={node.name}
            icon={FolderIcon}
            depth={depth}
            hasChildren
            isExpanded={isExpanded}
            isDragOver={isOver}
            onToggle={() => toggleFolder(node.path)}
            onClick={() => toggleFolder(node.path)}
            onContextMenu={(e) => onContextMenu(e, { type: 'folder', ...node })}
            rightActions={
              <>
                <button
                  type="button"
                  title={t('contextMenu.newPage')}
                  className="p-1 rounded-md hover:bg-gray-200 text-gray-500 hover:text-gray-900"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRequestCreatePage?.(node.path);
                  }}
                >
                  <DocumentPlusIcon className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title={t('contextMenu.newFolder')}
                  className="p-1 rounded-md hover:bg-gray-200 text-gray-500 hover:text-gray-900"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRequestCreateFolder?.(node.path);
                  }}
                >
                  <FolderPlusIcon className="h-3.5 w-3.5" />
                </button>
                <SidebarDropdown
                  items={[
                    { label: t('contextMenu.copyCitation'), icon: AtSymbolIcon, onClick: () => onCopyFolderCitation?.({ type: 'folder', ...node }) },
                    { label: t('contextMenu.move'), icon: FolderIcon, onClick: () => onMoveFolder?.({ type: 'folder', ...node }) },
                    { label: t('common.refresh'), icon: ArrowPathIcon, onClick: () => refreshFolder(node.path) },
                    { label: t('contextMenu.rename'), icon: PencilIcon, onClick: () => onRenameFolder?.({ type: 'folder', ...node }) },
                    { label: t('contextMenu.delete'), icon: TrashIcon, className: 'text-red-600', onClick: () => onDeleteFolder?.({ type: 'folder', ...node }) },
                  ]}
                >
                  <EllipsisHorizontalIcon className="h-3.5 w-3.5" />
                </SidebarDropdown>
              </>
            }
          >
            {isExpanded && (
              <div className="flex flex-col">
                {node.children.map((child) => (
                  <FolderTreeRenderer
                    key={child.path}
                    node={child}
                    depth={depth + 1}
                    expandedFolders={expandedFolders}
                    toggleFolder={toggleFolder}
                    folderDocs={folderDocs}
                    loadDoc={loadDoc}
                    selectedDoc={selectedDoc}
                    onContextMenu={onContextMenu}
                    refreshFolder={refreshFolder}
                    onCopyFolderCitation={onCopyFolderCitation}
                    onCopyDocCitation={onCopyDocCitation}
                    onRequestCreatePage={onRequestCreatePage}
                    onRequestCreateFolder={onRequestCreateFolder}
                    onMoveFolder={onMoveFolder}
                    onRenameFolder={onRenameFolder}
                    onDeleteFolder={onDeleteFolder}
                    onMoveDoc={onMoveDoc}
                    onEditDocDescription={onEditDocDescription}
                    onRenameDoc={onRenameDoc}
                    onDeleteDoc={onDeleteDoc}
                  />
                ))}
                {docs.length === 0 && node.children.length === 0 && (
                  <div
                    className="text-gray-400 italic text-xs py-1"
                    style={{ paddingLeft: `${(depth + 1) * 12 + 12}px` }}
                  >
                    Empty
                  </div>
                )}
                {docs.map((doc) => (
                  <DraggableSidebarItem key={doc.rel_path} id={`doc:${doc.rel_path}`} data={{ type: 'doc', rel_path: doc.rel_path }}>
                    <SidebarItem
                      label={doc.rel_path.split('/').pop().replace('.md', '')}
                      description={doc.description}
                      icon={DocumentTextIcon}
                      depth={depth + 1}
                      hasChildren={false}
                      isActive={selectedDoc?.rel_path === doc.rel_path}
                      onClick={() => loadDoc(doc, { urlMode: 'push' })}
                      onContextMenu={(e) => onContextMenu(e, { type: 'doc', ...doc })}
                      rightActions={
                        <SidebarDropdown
                          items={[
                            { label: t('contextMenu.copyCitation'), icon: AtSymbolIcon, onClick: () => onCopyDocCitation?.({ type: 'doc', ...doc }) },
                            { label: t('contextMenu.move'), icon: FolderIcon, onClick: () => onMoveDoc?.({ type: 'doc', ...doc }) },
                            { label: t('contextMenu.editDescription'), icon: PencilIcon, onClick: () => onEditDocDescription?.({ type: 'doc', ...doc }) },
                            { label: t('contextMenu.rename'), icon: PencilIcon, onClick: () => onRenameDoc?.({ type: 'doc', ...doc }) },
                            { label: t('contextMenu.delete'), icon: TrashIcon, className: 'text-red-600', onClick: () => onDeleteDoc?.({ type: 'doc', ...doc }) },
                          ]}
                        >
                          <EllipsisHorizontalIcon className="h-3.5 w-3.5" />
                        </SidebarDropdown>
                      }
                    />
                  </DraggableSidebarItem>
                ))}
              </div>
            )}
          </SidebarItem>
        </DraggableSidebarItem>
      )}
    </DroppableFolderWrapper>
  );
}

export function SidebarTree({
  folders,
  folderDocs,
  expandedFolders,
  toggleFolder,
  refreshFolder,
  refreshSidebarAll,
  loadDoc,
  selectedDoc,
  onContextMenu,
  onRequestCreateFolder,
  onRequestCreatePage,
  onRequestMoveFromDnd,
  onRequestSearch,
  onRequestSettings,
  onRequestIdea,
  onRequestCreateIdeaBox,
  onRequestRenameIdeaBox,
  onRequestDeleteIdeaBox,
  ideaLoader,
  onCopyFolderCitation,
  onCopyDocCitation,
  onMoveFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveDoc,
  onEditDocDescription,
  onRenameDoc,
  onDeleteDoc,
  activeView,
  sidebarWidth,
  startResizing,
}) {
  const { t } = useTranslation();
  const { DragRegion, dragProps } = useTauriDrag();
  const navigate = useNavigate();
  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);
  const [activeDragItem, setActiveDragItem] = useState(null);
  const [isIdeasExpanded, setIsIdeasExpanded] = useState(true);

  const buildIdeaRoute = useCallback((box, date) => {
    const safeBox = box ? encodeURIComponent(box) : '';
    const base = date ? ROUTES.IDEA_DATE(date) : ROUTES.IDEA;
    return safeBox ? `${base}?box=${safeBox}` : base;
  }, []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleDndDragStart = useCallback((event) => {
    const { active } = event || {};
    if (active?.data?.current) {
      setActiveDragItem(active.data.current);
    }
  }, []);

  const handleDndDragEnd = useCallback(
    (event) => {
      setActiveDragItem(null);
      const { active, over } = event || {};
      if (!active || !over) return;
      const overId = String(over.id || '');
      if (!overId.startsWith('folder-drop:')) return;
      const targetFolderPath = overId.slice('folder-drop:'.length);
      const payload = active.data?.current;
      if (!payload?.type) return;

      onRequestMoveFromDnd?.({ payload, targetFolderPath });
    },
    [onRequestMoveFromDnd],
  );

  const handleDndDragCancel = useCallback(() => {
    setActiveDragItem(null);
  }, []);

  return (
    <aside
      style={{ width: sidebarWidth }}
      className="flex-shrink-0 bg-[#F7F7F5] border-r border-[#E9E9E7] dark:bg-zinc-900 dark:border-zinc-800 flex flex-col relative group/sidebar pt-8"
    >
      {/* Drag Region for Traffic Lights Area */}
      <DragRegion className="absolute top-0 left-0 right-0 h-8 z-50" />

      <div 
        className="h-12 flex items-center px-4 m-2 relative z-10 select-none"
        {...dragProps}
      >
        <Logo className="h-7 w-7 mr-2.5 pointer-events-none" />
        <div className="flex items-center pointer-events-none font-display">
          <span className="text-lg font-medium text-gray-600 tracking-tight">Open</span>
          <span className="text-lg font-bold text-gray-900 tracking-tight">Context</span>
        </div>
      </div>

      {/* Search Entry - moved to top of files list */}
      <div className="flex-1 overflow-y-auto py-2">
      {/* Search Entry - Notion style */}
        <div className="px-2 mb-2">
        <button
          type="button"
          onClick={() => onRequestSearch?.()}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-[#5F5E5B] hover:bg-[#EFEFED] active:bg-[#E5E5E5] dark:text-zinc-300 dark:hover:bg-zinc-800 dark:active:bg-zinc-700 rounded-sm transition-colors duration-75 group font-medium"
        >
          <MagnifyingGlassIcon className="h-4 w-4 text-[#91918E] group-hover:text-[#5F5E5B] dark:text-zinc-500 dark:group-hover:text-zinc-300" strokeWidth={2} />
          <span className="flex-1 text-left">{t('search.searchDocs')}</span>
          <span className="text-xs text-[#9B9A97] dark:text-zinc-500 font-normal">⌘ K</span>
        </button>
      </div>

        {/* Ideas Section */}
        {ideaLoader && (
          <IdeaSidebar
            isExpanded={isIdeasExpanded}
            onToggleExpand={() => setIsIdeasExpanded(!isIdeasExpanded)}
            boxes={ideaLoader.boxes}
            selectedBox={ideaLoader.selectedBox}
            availableDatesByBox={ideaLoader.availableDatesByBox}
            onSelectBox={(box) => {
              ideaLoader.setSelectedBox(box);
              navigate(buildIdeaRoute(box, ideaLoader.selectedDate));
            }}
            onCreateBox={onRequestCreateIdeaBox}
            onRenameBox={onRequestRenameIdeaBox}
            onDeleteBox={onRequestDeleteIdeaBox}
            selectedDate={activeView === 'idea' ? ideaLoader.selectedDate : null}
            onSelectDate={(date, box) => {
              if (box && box !== ideaLoader.selectedBox) {
                ideaLoader.setSelectedBox(box);
              }
              ideaLoader.setSelectedDate(date);
              navigate(buildIdeaRoute(box || ideaLoader.selectedBox, date));
            }}
          />
        )}

        <div className="px-3 mb-2 flex items-center justify-between group">
          <span className="text-xs font-semibold text-gray-500 pl-2">{t('sidebar.spaces')}</span>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                refreshSidebarAll?.();
              }}
              className="p-1 hover:bg-gray-200 rounded"
              title={t('sidebar.refresh')}
            >
              <ArrowPathIcon className="h-3.5 w-3.5 text-gray-500" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRequestCreateFolder?.();
              }}
              className="p-1 hover:bg-gray-200 rounded"
              title={t('sidebar.newFolder')}
            >
              <FolderPlusIcon className="h-3.5 w-3.5 text-gray-500" />
            </button>
          </div>
        </div>

        <DndContext 
          sensors={sensors} 
          onDragStart={handleDndDragStart}
          onDragEnd={handleDndDragEnd}
          onDragCancel={handleDndDragCancel}
        >
          {folderTree.map((node) => (
            <FolderTreeRenderer
              key={node.path}
              node={node}
              depth={0}
              expandedFolders={expandedFolders}
              toggleFolder={toggleFolder}
              folderDocs={folderDocs}
              loadDoc={loadDoc}
              selectedDoc={selectedDoc}
              onContextMenu={onContextMenu}
              refreshFolder={refreshFolder}
              onCopyFolderCitation={onCopyFolderCitation}
              onCopyDocCitation={onCopyDocCitation}
              onRequestCreatePage={onRequestCreatePage}
              onRequestCreateFolder={onRequestCreateFolder}
              onMoveFolder={onMoveFolder}
              onRenameFolder={onRenameFolder}
              onDeleteFolder={onDeleteFolder}
              onMoveDoc={onMoveDoc}
              onEditDocDescription={onEditDocDescription}
              onRenameDoc={onRenameDoc}
              onDeleteDoc={onDeleteDoc}
            />
          ))}
          
          {/* Drag overlay - floating preview that follows cursor */}
          <DragOverlay dropAnimation={null}>
            {activeDragItem && (
              <div className="bg-white shadow-lg rounded-md px-3 py-2 border border-gray-200 text-sm text-gray-700 whitespace-nowrap">
                {activeDragItem.type === 'folder' ? (
                  <span className="flex items-center gap-2">
                    <FolderIcon className="h-4 w-4 text-gray-400" />
                    {activeDragItem.name || activeDragItem.path?.split('/').pop()}
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <DocumentTextIcon className="h-4 w-4 text-gray-400" />
                    {activeDragItem.title || activeDragItem.rel_path?.split('/').pop()?.replace('.md', '')}
                  </span>
                )}
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </div>

      <div className="p-2 border-t border-[#E9E9E7] dark:border-zinc-800 space-y-1">
        <button
          type="button"
          onClick={() => navigate(ROUTES.SETTINGS)}
          className={`
            w-full flex items-center gap-2 px-3 py-1.5 text-sm rounded-sm transition-colors duration-75 group font-medium
            ${activeView === 'settings' 
              ? 'bg-[#EFEFED] text-[#37352F] dark:bg-zinc-800 dark:text-zinc-100'
              : 'text-[#5F5E5B] hover:bg-[#EFEFED] active:bg-[#E5E5E5] dark:text-zinc-300 dark:hover:bg-zinc-800 dark:active:bg-zinc-700'}
          `}
        >
          <Cog6ToothIcon className={`h-4 w-4 ${activeView === 'settings' ? 'text-[#37352F] dark:text-zinc-100' : 'text-[#91918E] group-hover:text-[#5F5E5B] dark:text-zinc-500 dark:group-hover:text-zinc-300'}`} strokeWidth={2} />
          <span className="flex-1 text-left">{t('settings.title')}</span>
        </button>

        <button
          type="button"
          onClick={() => onRequestCreatePage?.('')}
          className="flex items-center gap-2 text-sm text-[#5F5E5B] hover:text-gray-900 dark:text-zinc-300 dark:hover:text-zinc-100 w-full px-3 py-1.5 rounded-sm hover:bg-[#EFEFED] active:bg-[#E5E5E5] dark:hover:bg-zinc-800 dark:active:bg-zinc-700 transition-colors"
        >
          <PlusIcon className="h-4 w-4" />
          <span>{t('sidebar.newPage')}</span>
        </button>
      </div>

      <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-gray-300/50 dark:hover:bg-zinc-700/60 transition-colors z-50" onMouseDown={startResizing} />
    </aside>
  );
}
