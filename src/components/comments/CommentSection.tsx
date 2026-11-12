import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MessageSquare, Send, Pencil, Trash2, X, Check } from 'lucide-react';
import { commentsAPI } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Comment } from '@/types';

interface CommentSectionProps {
  targetType: string;
  targetId: string;
}

function formatTimeAgo(dateStr: string, t: TFunction): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return t('relativeTime.justNow');
  if (diffMin < 60) return t('relativeTime.minutesAgo', { n: diffMin });
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return t('relativeTime.hoursAgo', { n: diffHrs });
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 30) return t('relativeTime.daysAgo', { n: diffDays });
  return date.toLocaleDateString();
}

function getCurrentUserId(): string {
  try {
    const stored = localStorage.getItem('patchman_user');
    if (stored) {
      const user = JSON.parse(stored);
      return user.id || '';
    }
  } catch {
    // ignore
  }
  return '';
}

function CommentItem({
  comment,
  onUpdated,
  onDeleted,
}: {
  comment: Comment;
  onUpdated: () => void;
  onDeleted: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { t } = useTranslation('comments');

  const currentUserId = getCurrentUserId();
  const isOwner = currentUserId === comment.userId;
  const authorName = comment.user?.name || t('authorFallback');
  const initials = authorName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);

  const handleUpdate = async () => {
    if (!editContent.trim()) return;
    try {
      await commentsAPI.update(comment.id, editContent.trim());
      setIsEditing(false);
      onUpdated();
    } catch {
      // handle silently
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await commentsAPI.delete(comment.id);
      onDeleted();
    } catch {
      // handle silently
    }
    setIsDeleting(false);
    setConfirmDelete(false);
  };

  return (
    <div className="flex gap-2 group">
      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
        <span className="text-[9px] font-medium text-primary">{initials}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium">{authorName}</span>
          <span className="text-[10px] text-muted-foreground">{formatTimeAgo(comment.createdAt, t)}</span>
          {isOwner && !isEditing && (
            <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={() => { setEditContent(comment.content); setIsEditing(true); }}
              >
                <Pencil className="h-2.5 w-2.5" />
              </Button>
              {confirmDelete ? (
                <div className="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 text-red-500 hover:text-red-600"
                    onClick={handleDelete}
                    disabled={isDeleting}
                  >
                    <Check className="h-2.5 w-2.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() => setConfirmDelete(false)}
                  >
                    <X className="h-2.5 w-2.5" />
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 text-red-500 hover:text-red-600"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="h-2.5 w-2.5" />
                </Button>
              )}
            </div>
          )}
        </div>
        {isEditing ? (
          <div className="mt-1 space-y-1">
            <Textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="text-xs min-h-[50px]"
              rows={2}
            />
            <div className="flex gap-1">
              <Button size="sm" className="h-6 text-xs px-2" onClick={handleUpdate} disabled={!editContent.trim()}>
                {t('common:save')}
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => setIsEditing(false)}>
                {t('common:cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap break-words">
            {comment.content}
          </p>
        )}
      </div>
    </div>
  );
}

export function CommentSection({ targetType, targetId }: CommentSectionProps) {
  const { t } = useTranslation('comments');
  const [comments, setComments] = useState<Comment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [isSending, setIsSending] = useState(false);

  const fetchComments = useCallback(async () => {
    if (!targetId) return;
    setIsLoading(true);
    try {
      const response = await commentsAPI.list(targetType, targetId);
      setComments(Array.isArray(response.data) ? response.data : []);
    } catch {
      // handle silently
    }
    setIsLoading(false);
  }, [targetType, targetId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  const handleSubmit = async () => {
    if (!newContent.trim() || isSending) return;
    setIsSending(true);
    try {
      await commentsAPI.create({
        targetType,
        targetId,
        content: newContent.trim(),
      });
      setNewContent('');
      fetchComments();
    } catch {
      // handle silently
    }
    setIsSending(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <MessageSquare className="h-3 w-3 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {t('title')} {comments.length > 0 && `(${comments.length})`}
        </span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-3">
          <div className="h-3 w-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : comments.length > 0 ? (
        <ScrollArea className={comments.length > 3 ? 'max-h-[200px]' : ''}>
          <div className="space-y-2.5">
            {comments.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                onUpdated={fetchComments}
                onDeleted={fetchComments}
              />
            ))}
          </div>
        </ScrollArea>
      ) : (
        <p className="text-[10px] text-muted-foreground text-center py-2">
          {t('empty')}
        </p>
      )}

      {/* New comment input */}
      <div className="flex gap-1.5">
        <Textarea
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          placeholder={t('placeholder')}
          className="text-xs min-h-[32px] flex-1"
          rows={1}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />
        <Button
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={handleSubmit}
          disabled={!newContent.trim() || isSending}
        >
          <Send className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
