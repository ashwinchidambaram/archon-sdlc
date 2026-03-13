import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { signIn as cognitoSignIn, signOut as cognitoSignOut, getIdToken, getCurrentUser, completeNewPassword, type AuthResult } from './cognito';
import type { CognitoUser } from 'amazon-cognito-identity-js';

interface AuthContextType {
  user: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => void;
  getToken: () => Promise<string | null>;
  handleNewPassword: (cognitoUser: CognitoUser, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getCurrentUser().then((username) => {
      setUser(username);
      setIsLoading(false);
    });
  }, []);

  const handleSignIn = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    const result = await cognitoSignIn(email, password);
    if (result.success) {
      setUser(email);
    }
    return result;
  }, []);

  const handleSignOut = useCallback(() => {
    cognitoSignOut();
    setUser(null);
  }, []);

  const handleNewPassword = useCallback(async (cognitoUser: CognitoUser, newPassword: string) => {
    await completeNewPassword(cognitoUser, newPassword);
    setUser(cognitoUser.getUsername());
  }, []);

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      isLoading,
      signIn: handleSignIn,
      signOut: handleSignOut,
      getToken: getIdToken,
      handleNewPassword,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
