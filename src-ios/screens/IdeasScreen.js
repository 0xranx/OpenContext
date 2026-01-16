const React = require('react');
const {
  View,
  Text,
  StyleSheet,
  SectionList,
  Modal,
  ScrollView,
  TextInput,
  InputAccessoryView,
  Image,
  Pressable,
  Alert,
  ActionSheetIOS,
  Animated,
  Easing,
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
} = require('react-native');
const { Swipeable } = require('react-native-gesture-handler');
const { useTranslation } = require('react-i18next');
const ImagePicker = require('expo-image-picker');
const { Ionicons } = require('@expo/vector-icons');
const Screen = require('../components/Screen');
const EmptyState = require('../components/EmptyState');
const FadeInView = require('../components/FadeInView');
const {
  listThreads,
  listBoxes,
  createThread,
  continueThread,
  deleteEntry,
  deleteThread,
  createBox,
  renameBox,
  deleteBox,
  moveThread,
} = require('../services/ideas');
const { importImageAsset } = require('../services/images');
const { loadAIConfig, isAIAvailable, generateReflection } = require('../services/ai');
const { typography, spacing, colors } = require('../theme');
const { formatDateDisplay, formatRelativeTime, formatDateKey } = require('../utils/ideaTime');

function IdeasScreen({ navigation }) {
  const { t, i18n } = useTranslation();
  const DEFAULT_BOX = 'inbox';
  const COMPOSER_MIN_HEIGHT = 40;
  const COMPOSER_PADDING = spacing.xs;
  const MAX_IMAGES = 6;
  const [threads, setThreads] = React.useState([]);
  const [boxes, setBoxes] = React.useState([DEFAULT_BOX]);
  const [selectedBox, setSelectedBox] = React.useState(DEFAULT_BOX);
  const [isMoveModalOpen, setIsMoveModalOpen] = React.useState(false);
  const [moveThreadId, setMoveThreadId] = React.useState(null);
  const [inputText, setInputText] = React.useState('');
  const [composerHeight, setComposerHeight] = React.useState(COMPOSER_MIN_HEIGHT);
  const [inputImages, setInputImages] = React.useState([]);
  const [replyingThreadId, setReplyingThreadId] = React.useState(null);
  const [replyText, setReplyText] = React.useState('');
  const [replyImages, setReplyImages] = React.useState([]);
  const [isReplyModalOpen, setIsReplyModalOpen] = React.useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = React.useState(false);
  const [isReplying, setIsReplying] = React.useState(false);
  const [reflectingThreadId, setReflectingThreadId] = React.useState(null);
  const [reflectionError, setReflectionError] = React.useState('');
  const [isReflecting, setIsReflecting] = React.useState(false);
  const [reflectionText, setReflectionText] = React.useState('');
  const [isSavingReflection, setIsSavingReflection] = React.useState(false);
  const [lastAddedEntryId, setLastAddedEntryId] = React.useState(null);
  const inputRef = React.useRef(null);
  const replyInputRef = React.useRef(null);
  const clearAnimRef = React.useRef(null);
  const moveAnimRef = React.useRef(new Animated.Value(0));
  const moveAnim = moveAnimRef.current;

  const normalizeBoxes = React.useCallback((items = []) => {
    const unique = Array.from(new Set([DEFAULT_BOX, ...items].filter(Boolean)));
    const rest = unique.filter((box) => box !== DEFAULT_BOX).sort();
    return [DEFAULT_BOX, ...rest];
  }, [DEFAULT_BOX]);

  const loadIdeas = React.useCallback(async (boxToLoad) => {
    const targetBox = boxToLoad || selectedBox || DEFAULT_BOX;
    const [threadData, boxData] = await Promise.all([
      listThreads({ box: targetBox }),
      listBoxes(),
    ]);
    const nextBoxes = normalizeBoxes(boxData);
    setBoxes(nextBoxes);
    if (!nextBoxes.includes(targetBox)) {
      const fallback = nextBoxes[0] || DEFAULT_BOX;
      setSelectedBox(fallback);
      const fallbackThreads = await listThreads({ box: fallback });
      setThreads(fallbackThreads);
      return;
    }
    setThreads(threadData);
  }, [DEFAULT_BOX, listThreads, listBoxes, normalizeBoxes, selectedBox]);

  React.useEffect(() => {
    loadIdeas(selectedBox);
  }, [loadIdeas, selectedBox]);

  React.useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => loadIdeas(selectedBox));
    return unsubscribe;
  }, [navigation, loadIdeas, selectedBox]);

  const handleCreate = async () => {
    const text = inputText.trim();
    if (!text && inputImages.length === 0) return;
    const thread = await createThread({ content: text, images: inputImages, box: selectedBox });
    setInputText('');
    setInputImages([]);
    setComposerHeight(COMPOSER_MIN_HEIGHT);
    if (inputRef.current) {
      inputRef.current.blur();
    }
    Keyboard.dismiss();
    const entryId = thread?.entries?.[0]?.id;
    if (entryId) {
      setLastAddedEntryId(entryId);
      if (clearAnimRef.current) {
        clearTimeout(clearAnimRef.current);
      }
      clearAnimRef.current = setTimeout(() => {
        setLastAddedEntryId(null);
      }, 600);
    }
    loadIdeas(selectedBox);
  };

  React.useEffect(() => {
    if (isReplyModalOpen && replyInputRef.current) {
      replyInputRef.current.focus();
    }
  }, [isReplyModalOpen]);

  React.useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () => setIsKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setIsKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const handleStartContinue = (threadId) => {
    setReflectingThreadId(null);
    setReflectionError('');
    setReflectionText('');
    setReplyingThreadId(threadId);
    setReplyText('');
    setReplyImages([]);
    setIsReplyModalOpen(true);
  };

  const handleCancelContinue = () => {
    setIsReplyModalOpen(false);
    setReplyingThreadId(null);
    setReplyText('');
    setReplyImages([]);
    if (replyInputRef.current) {
      replyInputRef.current.blur();
    }
    Keyboard.dismiss();
  };

  const handleSubmitContinue = async () => {
    const text = replyText.trim();
    if ((!text && replyImages.length === 0) || !replyingThreadId || isReplying) return;
    setIsReplying(true);
    try {
      const entry = await continueThread({ threadId: replyingThreadId, content: text, images: replyImages });
      let updated = false;
      setThreads((prev) =>
        prev.map((thread) => {
          if (thread.id !== replyingThreadId) {
            return thread;
          }
          updated = true;
          return {
            ...thread,
            updatedAt: entry?.createdAt || thread.updatedAt,
            entries: [...thread.entries, entry],
          };
        }),
      );
      setReplyingThreadId(null);
      setReplyText('');
      setReplyImages([]);
      setIsReplyModalOpen(false);
      if (replyInputRef.current) {
        replyInputRef.current.blur();
      }
      Keyboard.dismiss();
      if (!updated) {
        loadIdeas();
      }
    } finally {
      setIsReplying(false);
    }
  };

  const handleStartReflect = async (threadId) => {
    if (isReflecting) return;
    const config = await loadAIConfig();
    if (!isAIAvailable(config)) {
      Alert.alert(t('ideas.aiNotConfigured'));
      return;
    }
    setIsReplyModalOpen(false);
    setReplyingThreadId(null);
    setReflectionError('');
    setReflectionText('');
    setReflectingThreadId(threadId);
    setIsReflecting(true);
    try {
      const thread = threads.find((t) => t.id === threadId);
      const entries = thread?.entries || [];
      const text = await generateReflection(entries, { language: i18n.language, config });
      if (!text) {
        throw new Error(t('ideas.aiEmpty'));
      }
      setReflectionText(text);
    } catch (err) {
      setReflectionError(err?.message || t('ideas.aiError'));
    } finally {
      setIsReflecting(false);
    }
  };

  const handleSaveReflection = async () => {
    if (!reflectionText.trim() || !reflectingThreadId || isSavingReflection) return;
    setIsSavingReflection(true);
    try {
      const entry = await continueThread({
        threadId: reflectingThreadId,
        content: reflectionText.trim(),
        isAI: true,
      });
      setThreads((prev) =>
        prev.map((threadItem) => {
          if (threadItem.id !== reflectingThreadId) return threadItem;
          return {
            ...threadItem,
            updatedAt: entry?.createdAt || threadItem.updatedAt,
            entries: [...threadItem.entries, entry],
          };
        }),
      );
      setReflectingThreadId(null);
      setReflectionText('');
      setReflectionError('');
    } finally {
      setIsSavingReflection(false);
    }
  };

  const handleRetryReflect = () => {
    if (!reflectingThreadId) return;
    handleStartReflect(reflectingThreadId);
  };

  const handleCancelReflect = () => {
    setReflectingThreadId(null);
    setReflectionError('');
    setIsReflecting(false);
    setReflectionText('');
  };

  const pickImages = React.useCallback(async (target) => {
    const currentImages = target === 'main' ? inputImages : replyImages;
    const remaining = MAX_IMAGES - currentImages.length;
    if (remaining <= 0) {
      Alert.alert(t('ideas.imageLimit', { count: MAX_IMAGES }));
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('ideas.imagePermissionTitle'), t('ideas.imagePermissionBody'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: remaining > 1,
      selectionLimit: remaining,
      quality: 0.9,
    });
    if (result.canceled) return;
    const assets = result.assets || [];
    try {
      const stored = [];
      for (const asset of assets) {
        const uri = await importImageAsset(asset);
        if (uri) stored.push(uri);
      }
      if (stored.length === 0) return;
      if (target === 'main') {
        setInputImages((prev) => [...prev, ...stored]);
      } else {
        setReplyImages((prev) => [...prev, ...stored]);
      }
    } catch (error) {
      Alert.alert(t('ideas.imageImportFailed'));
    }
  }, [inputImages, replyImages, MAX_IMAGES, t]);

  const removeImage = React.useCallback((target, index) => {
    if (target === 'main') {
      setInputImages((prev) => prev.filter((_, idx) => idx !== index));
    } else {
      setReplyImages((prev) => prev.filter((_, idx) => idx !== index));
    }
  }, []);

  const clearThreadState = React.useCallback((threadId) => {
    if (replyingThreadId === threadId) {
      setIsReplyModalOpen(false);
      setReplyingThreadId(null);
      setReplyText('');
      setReplyImages([]);
    }
    if (reflectingThreadId === threadId) {
      setReflectingThreadId(null);
      setReflectionError('');
      setReflectionText('');
      setIsReflecting(false);
    }
  }, [reflectingThreadId, replyingThreadId]);

  const confirmDeleteEntry = React.useCallback((entry) => {
    Alert.alert(
      t('ideas.deleteEntryConfirm'),
      t('ideas.deleteEntryHint'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            await deleteEntry({ threadId: entry.threadId, entryId: entry.id });
            loadIdeas(selectedBox);
          },
        },
      ],
    );
  }, [deleteEntry, loadIdeas, selectedBox, t]);

  const confirmDeleteThread = React.useCallback((threadId) => {
    Alert.alert(
      t('ideas.deleteThreadConfirm'),
      t('ideas.deleteThreadHint'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            await deleteThread(threadId);
            clearThreadState(threadId);
            loadIdeas(selectedBox);
          },
        },
      ],
    );
  }, [clearThreadState, deleteThread, loadIdeas, selectedBox, t]);

  const handleEntryActions = React.useCallback((entry) => {
    const thread = threads.find((item) => item.id === entry.threadId);
    const canDeleteThread = (thread?.entries?.length || 0) > 1;
    const options = [
      t('ideas.deleteEntry'),
      ...(canDeleteThread ? [t('ideas.deleteThread')] : []),
      t('common.cancel'),
    ];
    const cancelButtonIndex = options.length - 1;
    const destructiveButtonIndex = canDeleteThread ? 1 : 0;

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex,
          destructiveButtonIndex,
          title: t('ideas.entryActionsTitle'),
        },
        (buttonIndex) => {
          if (buttonIndex === 0) {
            confirmDeleteEntry(entry);
          } else if (canDeleteThread && buttonIndex === 1) {
            confirmDeleteThread(entry.threadId);
          }
        },
      );
      return;
    }

    Alert.alert(
      t('ideas.entryActionsTitle'),
      undefined,
      [
        {
          text: t('ideas.deleteEntry'),
          style: 'destructive',
          onPress: () => confirmDeleteEntry(entry),
        },
        canDeleteThread
          ? {
              text: t('ideas.deleteThread'),
              style: 'destructive',
              onPress: () => confirmDeleteThread(entry.threadId),
            }
          : null,
        { text: t('common.cancel'), style: 'cancel' },
      ].filter(Boolean),
    );
  }, [confirmDeleteEntry, confirmDeleteThread, threads, t]);

  const renderSwipeActions = React.useCallback((entry, progress) => {
    const opacity = progress.interpolate({
      inputRange: [0, 0.4, 1],
      outputRange: [0, 0.7, 1],
      extrapolate: 'clamp',
    });
    const translateX = progress.interpolate({
      inputRange: [0, 1],
      outputRange: [12, 0],
      extrapolate: 'clamp',
    });
    const scale = progress.interpolate({
      inputRange: [0, 1],
      outputRange: [0.96, 1],
      extrapolate: 'clamp',
    });

    return (
      <View style={styles.swipeActions}>
        <Pressable
          style={styles.swipeDeletePressable}
          onPress={() => handleEntryActions(entry)}
        >
          <Animated.View
            style={[
              styles.swipeDelete,
              {
                opacity,
                transform: [{ translateX }, { scale }],
              },
            ]}
          >
            <Text style={styles.swipeDeleteText}>{t('common.delete')}</Text>
          </Animated.View>
        </Pressable>
      </View>
    );
  }, [handleEntryActions, t]);

  const validateBoxName = React.useCallback((value) => {
    const name = String(value || '').trim();
    if (!name) return null;
    if (name.includes('/') || name.includes('\\')) {
      Alert.alert(t('ideas.boxNameInvalid'));
      return null;
    }
    return name;
  }, [t]);

  const promptForBoxName = React.useCallback((title, message, actionLabel, initialValue, onSubmit) => {
    if (Platform.OS !== 'ios') {
      Alert.alert(title, message || '');
      return;
    }
    Alert.prompt(
      title,
      message,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: actionLabel,
          onPress: (value) => {
            const name = validateBoxName(value);
            if (!name) return;
            onSubmit(name);
          },
        },
      ],
      'plain-text',
      initialValue,
    );
  }, [t, validateBoxName]);

  const handleCreateBox = React.useCallback(() => {
    promptForBoxName(
      t('ideas.boxCreateTitle'),
      t('ideas.boxCreateHint'),
      t('common.create'),
      '',
      async (name) => {
        const box = await createBox(name);
        setSelectedBox(box);
        loadIdeas(box);
      },
    );
  }, [createBox, loadIdeas, promptForBoxName, t]);

  const handleRenameBox = React.useCallback((box) => {
    if (box === DEFAULT_BOX) return;
    promptForBoxName(
      t('ideas.boxRenameTitle'),
      t('ideas.boxRenameHint'),
      t('common.save'),
      box,
      async (name) => {
        const nextBox = await renameBox(box, name);
        if (box === selectedBox) {
          setSelectedBox(nextBox);
        }
        loadIdeas(nextBox);
      },
    );
  }, [DEFAULT_BOX, loadIdeas, promptForBoxName, renameBox, selectedBox, t]);

  const handleDeleteBox = React.useCallback((box) => {
    if (box === DEFAULT_BOX) return;
    Alert.alert(
      t('ideas.boxDeleteTitle'),
      t('ideas.boxDeleteConfirm', { name: box }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            await deleteBox(box);
            const nextBox = box === selectedBox ? DEFAULT_BOX : selectedBox;
            setSelectedBox(nextBox);
            loadIdeas(nextBox);
          },
        },
      ],
    );
  }, [DEFAULT_BOX, deleteBox, loadIdeas, selectedBox, t]);

  const handleBoxActions = React.useCallback((box) => {
    if (box === DEFAULT_BOX) return;
    Alert.alert(
      t('ideas.boxActionsTitle'),
      box,
      [
        { text: t('ideas.boxRename'), onPress: () => handleRenameBox(box) },
        { text: t('ideas.boxDelete'), style: 'destructive', onPress: () => handleDeleteBox(box) },
        { text: t('common.cancel'), style: 'cancel' },
      ],
    );
  }, [DEFAULT_BOX, handleDeleteBox, handleRenameBox, t]);

  const openMoveModal = React.useCallback((threadId) => {
    setMoveThreadId(threadId);
    setIsMoveModalOpen(true);
    moveAnim.setValue(0);
    Animated.timing(moveAnim, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [moveAnim]);

  const closeMoveModal = React.useCallback(() => {
    Animated.timing(moveAnim, {
      toValue: 0,
      duration: 180,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      setIsMoveModalOpen(false);
      setMoveThreadId(null);
    });
  }, [moveAnim]);

  const handleMoveThread = React.useCallback(async (targetBox) => {
    if (!moveThreadId) return;
    await moveThread({ threadId: moveThreadId, targetBox });
    closeMoveModal();
    loadIdeas(selectedBox);
  }, [closeMoveModal, loadIdeas, moveThread, moveThreadId, selectedBox]);

  const canPublish = inputText.trim().length > 0 || inputImages.length > 0;
  const canReplyPublish = replyText.trim().length > 0 || replyImages.length > 0;
  const sections = React.useMemo(() => buildSections(threads), [threads]);
  const replyThread = React.useMemo(
    () => threads.find((thread) => thread.id === replyingThreadId),
    [threads, replyingThreadId],
  );
  const mainAccessoryId = 'main-accessory';
  const replyAccessoryId = 'reply-accessory';
  const contextEntries = React.useMemo(() => {
    const entries = replyThread?.entries || [];
    const maxItems = isKeyboardVisible ? 1 : 2;
    return entries.slice(-maxItems);
  }, [replyThread, isKeyboardVisible]);

  const getEntryPreview = React.useCallback(
    (entry) => {
      const text = entry?.content?.trim();
      if (text) return text;
      if (entry?.images?.length) return t('ideas.addImage');
      return t('common.emptyTitle');
    },
    [t],
  );

  const handleDismissKeyboard = React.useCallback((target) => {
    if (target === 'main' && inputRef.current) {
      inputRef.current.blur();
    }
    if (target === 'reply' && replyInputRef.current) {
      replyInputRef.current.blur();
    }
    Keyboard.dismiss();
  }, []);

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <FadeInView style={styles.header}>
          <View style={styles.headerRow}>
            <Text style={styles.heading}>{t('ideas.title')}</Text>
            <Pressable style={styles.boxAddButton} onPress={handleCreateBox}>
              <Text style={styles.boxAddText}>+</Text>
            </Pressable>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.boxRowContent}
          >
            {boxes.map((box) => {
              const isActive = box === selectedBox;
              const label = box === DEFAULT_BOX ? t('ideas.boxInbox') : box;
              return (
                <Pressable
                  key={box}
                  onPress={() => setSelectedBox(box)}
                  onLongPress={() => handleBoxActions(box)}
                  style={[styles.boxChip, isActive && styles.boxChipActive]}
                >
                  <Text style={[styles.boxChipText, isActive && styles.boxChipTextActive]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable style={styles.boxAddChip} onPress={handleCreateBox}>
              <Text style={styles.boxAddChipText}>{t('ideas.boxAdd')}</Text>
            </Pressable>
          </ScrollView>
        </FadeInView>
        <View style={styles.composer}>
          <TextInput
            ref={inputRef}
            value={inputText}
            onChangeText={setInputText}
            placeholder={t('ideas.editorPlaceholder')}
            style={[styles.input, { height: composerHeight }]}
            onContentSizeChange={(event) => {
              const nextHeight = Math.max(
                COMPOSER_MIN_HEIGHT,
                event.nativeEvent.contentSize.height + COMPOSER_PADDING * 2,
              );
              setComposerHeight((prev) => (prev === nextHeight ? prev : nextHeight));
            }}
            multiline
            scrollEnabled={false}
            textAlignVertical="top"
            placeholderTextColor={colors.mutedInk}
            inputAccessoryViewID={Platform.OS === 'ios' ? mainAccessoryId : undefined}
          />
          {inputImages.length > 0 ? (
            <View style={styles.imageRow}>
              {inputImages.map((uri, index) => (
                <View key={`${uri}-${index}`} style={styles.imageItem}>
                  <Image source={{ uri }} style={styles.imageThumb} />
                  <Pressable
                    style={styles.imageRemove}
                    onPress={() => removeImage('main', index)}
                  >
                    <Text style={styles.imageRemoveText}>×</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
          <View style={styles.composerActions}>
            <Pressable
              style={styles.imageButton}
              onPress={() => pickImages('main')}
              accessibilityLabel={t('ideas.addImage')}
            >
              <ImageIcon />
            </Pressable>
            <Pressable
              style={[styles.publishButton, !canPublish && styles.publishButtonDisabled]}
              onPress={handleCreate}
              disabled={!canPublish}
            >
              <Text style={styles.publishText}>{t('ideas.publish')}</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.listWrapper}>
          {sections.length === 0 ? (
            <EmptyState title={t('ideas.emptyTitle')} body={t('ideas.emptyBody')} />
          ) : (
            <SectionList
              sections={sections}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              stickySectionHeadersEnabled={false}
              renderSectionHeader={({ section }) => (
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>
                    {formatDateDisplay(section.dateKey, t)}
                  </Text>
                  <View style={styles.sectionLine} />
                </View>
              )}
              renderItem={({ item }) => {
                const isReflectingEntry = item.isLastInThread && reflectingThreadId === item.threadId;
                return (
                <AnimatedEntry isActive={item.id === lastAddedEntryId}>
                  <Swipeable
                    renderRightActions={(progress) => renderSwipeActions(item, progress)}
                    overshootRight={false}
                  >
                    <View style={!isReflectingEntry && item.isLastInThread ? styles.entryBlockLast : null}>
                      <View style={styles.entryRow}>
                        <View style={styles.leftCol}>
                          {!item.isFirstInThread && (
                            <View style={[styles.lineTop, styles.lineUser]} />
                          )}
                          {!item.isLastInThread
                          || replyingThreadId === item.threadId
                          || reflectingThreadId === item.threadId ? (
                            <View style={[styles.lineBottom, styles.lineUser]} />
                          ) : null}
                          <View style={[styles.ball, item.isAI ? styles.ballAi : styles.ballUser]}>
                            {item.isAI ? <AiSparkle /> : null}
                          </View>
                        </View>
                        <View style={styles.entryRight}>
                          <View style={styles.entryHeader}>
                            <View style={styles.entryBody}>
                              <Text style={[styles.entryText, item.isAI ? styles.entryTextAi : null]}>
                                {item.content}
                              </Text>
                              {item.images?.length ? (
                                <View style={styles.entryImages}>
                                  {item.images.map((uri, index) => (
                                    <Image
                                      key={`${item.id}-img-${index}`}
                                      source={{ uri }}
                                      style={styles.entryImage}
                                    />
                                  ))}
                                </View>
                              ) : null}
                              {item.isLastInThread && replyingThreadId !== item.threadId && reflectingThreadId !== item.threadId ? (
                                <View style={styles.actionRow}>
                                  <Pressable
                                    onPress={() => handleStartContinue(item.threadId)}
                                    style={styles.continueButton}
                                  >
                                    <Text style={styles.continueText}>{t('ideas.continue')}</Text>
                                  </Pressable>
                                  <Pressable
                                    onPress={() => handleStartReflect(item.threadId)}
                                    style={styles.aiButton}
                                  >
                                    <Text style={styles.aiText}>{t('ideas.aiReflect')}</Text>
                                  </Pressable>
                                  <Pressable
                                    onPress={() => openMoveModal(item.threadId)}
                                    style={styles.moveButton}
                                  >
                                    <Text style={styles.moveText}>{t('ideas.boxMove')}</Text>
                                  </Pressable>
                                </View>
                              ) : null}
                            </View>
                            <View style={styles.entryMetaRow}>
                              <Text style={styles.entryMeta}>
                                {formatRelativeTime(item.createdAt, t)}
                              </Text>
                            </View>
                          </View>
                        </View>
                      </View>
                    </View>
                  </Swipeable>

                  {isReflectingEntry ? (
                    <AnimatedEntry isActive>
                      <View style={[styles.entryRow, styles.entryBlockLast]}>
                        <View style={styles.leftCol}>
                          <View style={[styles.lineTop, styles.lineUser]} />
                          <View style={[styles.ball, styles.ballAi]}>
                            <AiSparkle />
                          </View>
                        </View>
                        <View style={styles.entryRight}>
                          <View style={styles.entryHeader}>
                            <View style={styles.entryBody}>
                              {isReflecting ? (
                                <View style={styles.aiThinkingRow}>
                                  <ActivityIndicator size="small" color={colors.accent} />
                                  <Text style={styles.aiThinkingText}>{t('ideas.aiThinking')}</Text>
                                </View>
                              ) : reflectionError ? (
                                <View style={styles.aiErrorBox}>
                                  <Text style={styles.aiErrorText}>{reflectionError}</Text>
                                  <View style={styles.aiErrorActions}>
                                    <Pressable style={styles.replyButtonGhost} onPress={handleCancelReflect}>
                                      <Text style={styles.replyCancel}>{t('common.cancel')}</Text>
                                    </Pressable>
                                    <Pressable style={styles.replyButtonPrimary} onPress={handleRetryReflect}>
                                      <Text style={styles.replySubmit}>{t('ideas.aiRetry')}</Text>
                                    </Pressable>
                                  </View>
                                </View>
                              ) : (
                                <View>
                                  <TextInput
                                    value={reflectionText}
                                    onChangeText={setReflectionText}
                                    placeholder={t('ideas.aiPlaceholder')}
                                    style={styles.reflectionInput}
                                    multiline
                                    textAlignVertical="top"
                                    placeholderTextColor={colors.mutedInk}
                                  />
                                  <View style={styles.reflectionFooter}>
                                    <Text style={styles.reflectionHint}>{t('ideas.reflectionEditable')}</Text>
                                    <View style={styles.replyActions}>
                                      <Pressable style={styles.replyButtonGhost} onPress={handleCancelReflect}>
                                        <Text style={styles.replyCancel}>{t('common.cancel')}</Text>
                                      </Pressable>
                                      <Pressable
                                        style={styles.replyButtonPrimary}
                                        onPress={handleSaveReflection}
                                        disabled={!reflectionText.trim() || isSavingReflection}
                                      >
                                        <Text style={styles.replySubmit}>{t('common.save')}</Text>
                                      </Pressable>
                                    </View>
                                  </View>
                                </View>
                              )}
                            </View>
                          </View>
                        </View>
                      </View>
                    </AnimatedEntry>
                  ) : null}
                </AnimatedEntry>
                );
              }}
              contentContainerStyle={styles.list}
            />
          )}
        </View>
      </KeyboardAvoidingView>
      <Modal
        visible={isReplyModalOpen}
        animationType="slide"
        onRequestClose={handleCancelContinue}
      >
        <Screen>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.replyModalRoot}
          >
            <View style={styles.replyModalHeader}>
              <Pressable style={styles.replyModalCancel} onPress={handleCancelContinue}>
                <Text style={styles.replyModalCancelText}>{t('common.cancel')}</Text>
              </Pressable>
              <Text style={styles.replyModalTitle}>{t('ideas.continue')}</Text>
              <Pressable
                style={[
                  styles.replyModalPublish,
                  (!canReplyPublish || isReplying) && styles.replyModalPublishDisabled,
                ]}
                onPress={handleSubmitContinue}
                disabled={!canReplyPublish || isReplying}
              >
                <Text style={styles.replyModalPublishText}>
                  {isReplying ? t('common.save') : t('ideas.publish')}
                </Text>
              </Pressable>
            </View>
            <View style={styles.replyModalBody}>
              <ScrollView
                style={[
                  styles.replyModalContext,
                  isKeyboardVisible && styles.replyModalContextCompact,
                ]}
                contentContainerStyle={styles.replyModalContextContent}
                showsVerticalScrollIndicator={false}
                keyboardDismissMode="on-drag"
              >
                {contextEntries.map((entry, index) => {
                  const isFirst = index === 0;
                  const isLast = index === contextEntries.length - 1;
                  return (
                    <View key={entry.id || `${entry.createdAt}-${index}`} style={styles.replyContextItem}>
                    <View style={styles.replyContextRow}>
                      <View style={styles.replyContextLeft}>
                          {!isFirst ? <View style={[styles.lineTop, styles.lineUser]} /> : null}
                          {!isLast ? <View style={[styles.lineBottom, styles.lineUser]} /> : null}
                          <View style={[styles.ball, entry.isAI ? styles.ballAi : styles.ballUser]}>
                            {entry.isAI ? <AiSparkle /> : null}
                          </View>
                        </View>
                        <View
                          style={[
                            styles.replyContextRight,
                            isLast && styles.replyContextRightLast,
                          ]}
                        >
                          <View style={styles.replyContextHeader}>
                            <View style={styles.replyContextBody}>
                              <Text style={[styles.replyContextText, entry.isAI ? styles.entryTextAi : null]}>
                                {getEntryPreview(entry)}
                              </Text>
                              {entry?.images?.length ? (
                                <View style={styles.replyContextImages}>
                                  {entry.images.map((uri, imageIndex) => (
                                    <Image
                                      key={`${uri}-${imageIndex}`}
                                      source={{ uri }}
                                      style={styles.replyContextImage}
                                    />
                                  ))}
                                </View>
                              ) : null}
                            </View>
                            <Text style={styles.replyContextMeta}>
                              {formatRelativeTime(entry.createdAt, t)}
                            </Text>
                          </View>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
              <View style={styles.replyModalDivider} />
              <View style={styles.replyModalComposer}>
                <View style={styles.replyModalInputWrap}>
                  <TextInput
                    ref={replyInputRef}
                    value={replyText}
                    onChangeText={setReplyText}
                    placeholder={t('ideas.continuePlaceholder')}
                    style={styles.replyModalInput}
                    multiline
                    textAlignVertical="top"
                    placeholderTextColor={colors.mutedInk}
                    inputAccessoryViewID={Platform.OS === 'ios' ? replyAccessoryId : undefined}
                  />
                </View>
                {replyImages.length > 0 ? (
                  <View style={styles.imageRow}>
                    {replyImages.map((uri, index) => (
                      <View key={`${uri}-${index}`} style={styles.imageItem}>
                        <Image source={{ uri }} style={styles.imageThumb} />
                        <Pressable
                          style={styles.imageRemove}
                          onPress={() => removeImage('reply', index)}
                        >
                          <Text style={styles.imageRemoveText}>×</Text>
                        </Pressable>
                      </View>
                    ))}
                  </View>
                ) : null}
                {Platform.OS !== 'ios' || !isKeyboardVisible ? (
                  <View style={styles.replyModalActions}>
                    <Pressable
                      style={styles.imageButton}
                      onPress={() => pickImages('reply')}
                      accessibilityLabel={t('ideas.addImage')}
                    >
                      <ImageIcon />
                    </Pressable>
                  </View>
                ) : null}
              </View>
            </View>
          </KeyboardAvoidingView>
        </Screen>
      </Modal>
      {Platform.OS === 'ios' ? (
        <>
          <InputAccessoryView nativeID={mainAccessoryId}>
            <View style={styles.accessoryBar}>
              <Pressable
                style={styles.accessoryDone}
                onPress={() => handleDismissKeyboard('main')}
              >
                <Ionicons name="chevron-down" size={14} color={colors.accent} />
                <Text style={styles.accessoryDoneText}>{t('common.hideKeyboard')}</Text>
              </Pressable>
            </View>
          </InputAccessoryView>
          <InputAccessoryView nativeID={replyAccessoryId}>
            <View style={styles.replyAccessoryBar}>
              <Pressable
                style={styles.imageButton}
                onPress={() => pickImages('reply')}
                accessibilityLabel={t('ideas.addImage')}
              >
                <ImageIcon />
              </Pressable>
              <Pressable
                style={styles.accessoryDone}
                onPress={() => handleDismissKeyboard('reply')}
              >
                <Ionicons name="chevron-down" size={14} color={colors.accent} />
                <Text style={styles.accessoryDoneText}>{t('common.hideKeyboard')}</Text>
              </Pressable>
            </View>
          </InputAccessoryView>
        </>
      ) : null}
      <Modal
        transparent
        visible={isMoveModalOpen}
        animationType="fade"
        onRequestClose={closeMoveModal}
      >
        <Animated.View
          style={[
            styles.modalOverlay,
            { opacity: moveAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }) },
          ]}
        >
          <Pressable style={StyleSheet.absoluteFillObject} onPress={closeMoveModal} />
          <Animated.View
            style={[
              styles.modalContainer,
              { transform: [{ translateY: moveAnim.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) }] },
            ]}
          >
            <View style={styles.modalSheet}>
              <Text style={styles.modalTitle}>{t('ideas.boxMoveTitle')}</Text>
              <Text style={styles.modalSubtitle}>{t('ideas.boxMoveHint')}</Text>
              <View style={styles.modalDivider} />
              <ScrollView
                style={styles.modalList}
                contentContainerStyle={styles.modalListContent}
                showsVerticalScrollIndicator={false}
              >
                {[...boxes].sort((a, b) => {
                  if (a === selectedBox) return -1;
                  if (b === selectedBox) return 1;
                  if (a === DEFAULT_BOX) return -1;
                  if (b === DEFAULT_BOX) return 1;
                  return a.localeCompare(b);
                }).map((box, index) => {
                  const isCurrent = box === selectedBox;
                  const label = box === DEFAULT_BOX ? t('ideas.boxInbox') : box;
                  return (
                    <Pressable
                      key={box}
                      onPress={() => handleMoveThread(box)}
                      disabled={isCurrent}
                      style={[
                        styles.modalItem,
                        index === 0 && styles.modalItemFirst,
                        isCurrent && styles.modalItemDisabled,
                      ]}
                    >
                      <View style={styles.modalItemRow}>
                        <Text style={[styles.modalItemText, isCurrent && styles.modalItemTextDisabled]}>
                          {label}
                        </Text>
                        {isCurrent ? (
                          <View style={styles.modalBadge}>
                            <Text style={styles.modalBadgeText}>{t('ideas.boxCurrent')}</Text>
                          </View>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
            <Pressable style={styles.modalCancelSheet} onPress={closeMoveModal}>
              <Text style={styles.modalCancelText}>{t('common.cancel')}</Text>
            </Pressable>
          </Animated.View>
        </Animated.View>
      </Modal>
    </Screen>
  );
}

function buildSections(threads) {
  const threadsWithLatest = threads.map((thread) => {
    const latestEntry = thread.entries[thread.entries.length - 1];
    return {
      ...thread,
      latestTime: latestEntry?.createdAt ? new Date(latestEntry.createdAt).getTime() : 0,
    };
  });

  const sortedThreads = [...threadsWithLatest].sort((a, b) => b.latestTime - a.latestTime);
  const entriesByDate = new Map();

  sortedThreads.forEach((thread) => {
    const firstEntry = thread.entries[0];
    const date = formatDateKey(firstEntry?.createdAt || new Date());
    if (!entriesByDate.has(date)) {
      entriesByDate.set(date, []);
    }
    thread.entries.forEach((entry, index) => {
      entriesByDate.get(date).push({
        ...entry,
        threadId: thread.id,
        threadTitle: thread.title,
        isFirstInThread: index === 0,
        isLastInThread: index === thread.entries.length - 1,
        type: entry.isAI ? 'ai' : 'user',
      });
    });
  });

  return Array.from(entriesByDate.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([dateKey, data]) => ({
      dateKey,
      data,
    }));
}

function AiSparkle() {
  return (
    <View style={styles.aiSparkle}>
      <View style={[styles.sparkleLine, styles.sparkleLineH]} />
      <View style={[styles.sparkleLine, styles.sparkleLineV]} />
      <View style={[styles.sparkleLine, styles.sparkleLineD1]} />
      <View style={[styles.sparkleLine, styles.sparkleLineD2]} />
    </View>
  );
}

function ImageIcon() {
  return (
    <View style={styles.imageIcon}>
      <View style={styles.imageIconFrame} />
      <View style={styles.imageIconSun} />
      <View style={styles.imageIconHillLeft} />
      <View style={styles.imageIconHillRight} />
      <View style={styles.imageIconBadge}>
        <View style={styles.imageIconPlusH} />
        <View style={styles.imageIconPlusV} />
      </View>
    </View>
  );
}

function AnimatedEntry({ isActive, children }) {
  const opacity = React.useRef(new Animated.Value(isActive ? 0 : 1)).current;
  const translateY = React.useRef(new Animated.Value(isActive ? 10 : 0)).current;
  const hasAnimatedRef = React.useRef(false);

  React.useEffect(() => {
    if (!isActive || hasAnimatedRef.current) return;
    hasAnimatedRef.current = true;
    opacity.setValue(0);
    translateY.setValue(10);
    Animated.timing(opacity, {
      toValue: 1,
      duration: 360,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    Animated.timing(translateY, {
      toValue: 0,
      duration: 360,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [isActive, opacity, translateY]);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    marginBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  heading: {
    ...typography.title,
    fontSize: 28,
    fontWeight: '700',
  },
  boxRowContent: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingBottom: spacing.xs,
  },
  boxChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#f4f1ed',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  boxChipActive: {
    backgroundColor: colors.paper,
    borderColor: colors.accent,
  },
  boxChipText: {
    fontFamily: typography.subtitle.fontFamily,
    fontSize: 12,
    color: colors.mutedInk,
  },
  boxChipTextActive: {
    color: colors.ink,
    fontWeight: '600',
  },
  boxAddButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paper,
  },
  boxAddText: {
    fontSize: 16,
    color: colors.mutedInk,
    fontWeight: '600',
  },
  boxAddChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.paper,
  },
  boxAddChipText: {
    fontFamily: typography.subtitle.fontFamily,
    fontSize: 12,
    color: colors.mutedInk,
  },
  subhead: {
    ...typography.subtitle,
    marginTop: spacing.xs,
  },
  composer: {
    marginBottom: spacing.lg,
    paddingVertical: spacing.xs,
  },
  prompt: {
    ...typography.subtitle,
    color: colors.mutedInk,
    marginBottom: spacing.xs,
  },
  input: {
    ...typography.body,
    lineHeight: 24,
    paddingVertical: spacing.xs,
  },
  imageRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
  },
  imageItem: {
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  imageThumb: {
    width: 84,
    height: 84,
    borderRadius: 12,
    backgroundColor: '#f3f4f6',
  },
  imageRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageRemoveText: {
    fontSize: 12,
    color: colors.mutedInk,
    fontWeight: '600',
  },
  composerActions: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  imageButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: '#f2f0ed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageIcon: {
    width: 18,
    height: 18,
  },
  imageIconFrame: {
    position: 'absolute',
    top: 2,
    left: 2,
    width: 14,
    height: 12,
    borderWidth: 1.4,
    borderColor: colors.mutedInk,
    borderRadius: 3,
  },
  imageIconSun: {
    position: 'absolute',
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.mutedInk,
    top: 5,
    left: 5,
  },
  imageIconHillLeft: {
    position: 'absolute',
    width: 7,
    height: 1.4,
    backgroundColor: colors.mutedInk,
    left: 5,
    bottom: 6,
    transform: [{ rotate: '-25deg' }],
  },
  imageIconHillRight: {
    position: 'absolute',
    width: 6,
    height: 1.4,
    backgroundColor: colors.mutedInk,
    left: 9,
    bottom: 6,
    transform: [{ rotate: '25deg' }],
  },
  imageIconBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageIconPlusH: {
    position: 'absolute',
    width: 4,
    height: 1.2,
    backgroundColor: '#ffffff',
    borderRadius: 1,
  },
  imageIconPlusV: {
    position: 'absolute',
    width: 1.2,
    height: 4,
    backgroundColor: '#ffffff',
    borderRadius: 1,
  },
  publishButtonDisabled: {
    opacity: 0.5,
  },
  publishButton: {
    backgroundColor: '#f2f0ed',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
  },
  publishText: {
    ...typography.subtitle,
    fontWeight: '600',
    color: '#8b5a3c',
  },
  listWrapper: {
    flex: 1,
  },
  list: {
    paddingBottom: spacing.xl,
    paddingTop: spacing.sm,
    paddingRight: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.mutedInk,
  },
  sectionLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  entryRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  entryBlockLast: {
    marginBottom: spacing.md,
  },
  leftCol: {
    width: 24,
    alignItems: 'center',
    position: 'relative',
  },
  lineTop: {
    position: 'absolute',
    top: 0,
    height: 4,
    width: 2,
    left: 11,
  },
  lineBottom: {
    position: 'absolute',
    top: 28,
    bottom: 0,
    width: 2,
    left: 11,
  },
  lineUser: {
    backgroundColor: '#d6d3d1',
  },
  ball: {
    width: 16,
    height: 16,
    borderRadius: 8,
    marginTop: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ballUser: {
    backgroundColor: '#f59e7a',
  },
  ballAi: {
    backgroundColor: '#fed7aa',
  },
  ballReply: {
    backgroundColor: '#f59e7a',
  },
  aiSparkle: {
    width: 8,
    height: 8,
  },
  sparkleLine: {
    position: 'absolute',
    backgroundColor: '#ffffff',
    borderRadius: 1,
  },
  sparkleLineH: {
    width: 8,
    height: 1,
    top: 3.5,
    left: 0,
  },
  sparkleLineV: {
    width: 1,
    height: 8,
    left: 3.5,
    top: 0,
  },
  sparkleLineD1: {
    width: 6,
    height: 1,
    left: 1,
    top: 3.5,
    transform: [{ rotate: '45deg' }],
  },
  sparkleLineD2: {
    width: 6,
    height: 1,
    left: 1,
    top: 3.5,
    transform: [{ rotate: '-45deg' }],
  },
  entryRight: {
    flex: 1,
    paddingBottom: spacing.lg,
    paddingTop: 2,
  },
  entryHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  entryBody: {
    flex: 1,
  },
  entryImages: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
  },
  entryImage: {
    width: 140,
    height: 140,
    borderRadius: 14,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
    backgroundColor: '#f3f4f6',
  },
  entryText: {
    ...typography.body,
    lineHeight: 24,
    color: '#111827',
  },
  entryTextAi: {
    ...typography.subtitle,
    color: '#6b7280',
  },
  entryMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  entryMeta: {
    ...typography.label,
  },
  continueText: {
    fontFamily: typography.subtitle.fontFamily,
    fontSize: 11,
    color: '#c4551a',
  },
  continueButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#fff1e6',
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    alignItems: 'center',
  },
  swipeActions: {
    width: 80,
    justifyContent: 'stretch',
    alignItems: 'stretch',
    paddingLeft: spacing.sm,
  },
  swipeDelete: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ff3b30',
  },
  swipeDeletePressable: {
    flex: 1,
  },
  swipeDeleteText: {
    fontFamily: typography.subtitle.fontFamily,
    fontSize: 12,
    color: '#ffffff',
    fontWeight: '600',
  },
  aiButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#f2f0ed',
  },
  aiText: {
    fontFamily: typography.subtitle.fontFamily,
    fontSize: 11,
    color: '#8b5a3c',
  },
  moveButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#eef2f7',
  },
  moveText: {
    fontFamily: typography.subtitle.fontFamily,
    fontSize: 11,
    color: colors.mutedInk,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
  },
  modalSheet: {
    backgroundColor: colors.paper,
    borderRadius: 18,
    paddingTop: spacing.md,
    overflow: 'hidden',
  },
  modalTitle: {
    ...typography.subtitle,
    fontSize: 15,
    fontWeight: '600',
    color: colors.ink,
    textAlign: 'center',
  },
  modalSubtitle: {
    ...typography.subtitle,
    marginTop: 4,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  modalDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  modalList: {
    maxHeight: 260,
  },
  modalListContent: {
    paddingBottom: spacing.xs,
  },
  modalItem: {
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.paper,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  modalItemFirst: {
    borderTopWidth: 0,
  },
  modalItemRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  modalItemDisabled: {
    opacity: 0.5,
  },
  modalItemText: {
    ...typography.body,
    fontSize: 15,
    color: colors.ink,
  },
  modalItemTextDisabled: {
    color: colors.mutedInk,
  },
  modalBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
  },
  modalBadgeText: {
    ...typography.label,
    fontSize: 10,
    color: colors.mutedInk,
    letterSpacing: 0.4,
  },
  modalItemSecondary: {
    ...typography.body,
    fontSize: 15,
    color: colors.accent,
    fontWeight: '600',
  },
  modalCancelSheet: {
    marginTop: spacing.sm,
    backgroundColor: colors.paper,
    borderRadius: 18,
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
  },
  modalCancelText: {
    ...typography.body,
    fontSize: 16,
    color: colors.ink,
    fontWeight: '600',
  },
  replyModalRoot: {
    flex: 1,
  },
  replyModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  replyModalCancel: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  replyModalCancelText: {
    ...typography.subtitle,
    fontSize: 12,
    color: colors.mutedInk,
  },
  replyModalTitle: {
    ...typography.subtitle,
    fontSize: 15,
    fontWeight: '600',
    color: colors.ink,
  },
  replyModalPublish: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#fce8db',
  },
  replyModalPublishDisabled: {
    opacity: 0.5,
  },
  replyModalPublishText: {
    fontFamily: typography.subtitle.fontFamily,
    fontSize: 11,
    color: colors.accent,
    fontWeight: '600',
  },
  replyModalBody: {
    flex: 1,
  },
  replyModalContext: {
    flexGrow: 0,
    maxHeight: 220,
  },
  replyModalContextCompact: {
    maxHeight: 120,
  },
  replyModalContextContent: {
    paddingBottom: spacing.xs,
  },
  replyModalDivider: {
    height: 0,
    backgroundColor: 'transparent',
  },
  replyContextItem: {
    paddingBottom: 0,
  },
  replyContextRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  replyContextLeft: {
    width: 24,
    alignItems: 'center',
    position: 'relative',
  },
  replyContextRight: {
    flex: 1,
    paddingTop: 2,
    paddingBottom: spacing.lg,
  },
  replyContextRightLast: {
    paddingBottom: spacing.sm,
  },
  replyContextHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  replyContextBody: {
    flex: 1,
  },
  replyContextText: {
    ...typography.body,
    color: colors.ink,
    lineHeight: 22,
  },
  replyContextImages: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
  },
  replyContextImage: {
    width: 96,
    height: 96,
    borderRadius: 14,
    backgroundColor: '#f3f4f6',
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  replyContextMeta: {
    ...typography.label,
    color: colors.mutedInk,
  },
  replyModalComposer: {
    flex: 1,
    paddingTop: spacing.xs,
  },
  replyModalInputWrap: {
    flex: 1,
    backgroundColor: '#f7f4f1',
    borderRadius: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  replyModalInput: {
    ...typography.body,
    minHeight: 200,
    flex: 1,
    lineHeight: 22,
    paddingVertical: 0,
    textAlignVertical: 'top',
  },
  replyModalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  accessoryBar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.paper,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  accessoryDone: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  accessoryDoneText: {
    fontFamily: typography.subtitle.fontFamily,
    fontSize: 12,
    color: colors.accent,
    fontWeight: '600',
  },
  replyAccessoryBar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.paper,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  replyRow: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  replyBody: {
    flex: 1,
  },
  replyInput: {
    ...typography.body,
    minHeight: 72,
    lineHeight: 22,
    paddingVertical: spacing.sm,
  },
  replyFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  replyActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.md,
  },
  replyButtonGhost: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#f4f1ed',
  },
  replyCancel: {
    fontFamily: typography.subtitle.fontFamily,
    fontSize: 11,
    color: colors.mutedInk,
  },
  replyButtonPrimary: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#fce8db',
  },
  replySubmit: {
    fontFamily: typography.subtitle.fontFamily,
    fontSize: 11,
    color: colors.accent,
    fontWeight: '600',
  },
  aiThinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 2,
  },
  aiThinkingText: {
    ...typography.subtitle,
    color: colors.mutedInk,
  },
  aiErrorBox: {
    paddingVertical: spacing.sm,
  },
  aiErrorText: {
    ...typography.subtitle,
    color: '#b42318',
  },
  aiErrorActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  reflectionInput: {
    ...typography.body,
    minHeight: 90,
    lineHeight: 22,
    paddingVertical: spacing.sm,
  },
  reflectionFooter: {
    marginTop: spacing.sm,
  },
  reflectionHint: {
    fontFamily: typography.subtitle.fontFamily,
    fontSize: 10,
    color: colors.mutedInk,
    marginBottom: spacing.xs,
  },
});

module.exports = IdeasScreen;
