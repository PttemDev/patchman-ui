import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { PatchmanLogo } from '@/components/PatchmanLogo';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { emailPlaceholder } from '@/lib/tenant';

export function RegisterPage() {
  const { t } = useTranslation(['auth', 'common']);
  const navigate = useNavigate();
  const { register } = useAuthStore();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError(t('auth:register.passwordMismatch'));
      return;
    }

    if (password.length < 6) {
      setError(t('auth:register.passwordTooShort'));
      return;
    }

    setLoading(true);

    try {
      await register(name, email, password);
      navigate('/');
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosError = err as { response?: { data?: { message?: string } } };
        setError(axiosError.response?.data?.message || t('auth:register.failed'));
      } else {
        setError(t('auth:register.failed'));
      }
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <PatchmanLogo size={40} />
            <span className="text-3xl font-bold tracking-tight">PatchMan</span>
          </div>
          <p className="text-sm text-muted-foreground">
            {t('auth:tagline')}
          </p>
        </div>

        <div className="border rounded-lg bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-1">{t('auth:register.heading')}</h2>
          <p className="text-sm text-muted-foreground mb-6">
            {t('auth:register.subtitle')}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="name">{t('common:name')}</Label>
              <Input
                id="name"
                type="text"
                placeholder={t('auth:register.namePlaceholder')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">{t('auth:fields.emailLabel')}</Label>
              <Input
                id="email"
                type="email"
                placeholder={emailPlaceholder()}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{t('auth:fields.passwordLabel')}</Label>
              <Input
                id="password"
                type="password"
                placeholder={t('auth:register.passwordPlaceholder')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">{t('auth:register.confirmPasswordLabel')}</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder={t('auth:register.confirmPasswordPlaceholder')}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t('auth:register.submit')}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              {t('auth:register.haveAccount')}{' '}
              <Link
                to="/login"
                className="text-primary font-medium hover:underline"
              >
                {t('auth:register.signIn')}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
