import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';

const getUserPool = (): CognitoUserPool => {
  return new CognitoUserPool({
    UserPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
    ClientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
  });
};

export interface SignInResult {
  success: true;
  session: CognitoUserSession;
}

export interface NewPasswordRequired {
  success: false;
  challengeName: 'NEW_PASSWORD_REQUIRED';
  cognitoUser: CognitoUser;
}

export type AuthResult = SignInResult | NewPasswordRequired;

export function signIn(email: string, password: string): Promise<AuthResult> {
  return new Promise((resolve, reject) => {
    const userPool = getUserPool();
    const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });
    const authDetails = new AuthenticationDetails({ Username: email, Password: password });

    cognitoUser.authenticateUser(authDetails, {
      onSuccess: (session) => resolve({ success: true, session }),
      onFailure: (err) => reject(err),
      newPasswordRequired: () => resolve({ success: false, challengeName: 'NEW_PASSWORD_REQUIRED', cognitoUser }),
    });
  });
}

export function completeNewPassword(cognitoUser: CognitoUser, newPassword: string): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => {
    cognitoUser.completeNewPasswordChallenge(newPassword, {}, {
      onSuccess: (session) => resolve(session),
      onFailure: (err) => reject(err),
    });
  });
}

export function signOut(): void {
  const userPool = getUserPool();
  const currentUser = userPool.getCurrentUser();
  if (currentUser) {
    currentUser.signOut();
  }
}

export function getIdToken(): Promise<string | null> {
  return new Promise((resolve) => {
    const userPool = getUserPool();
    const currentUser = userPool.getCurrentUser();
    if (!currentUser) {
      resolve(null);
      return;
    }
    currentUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) {
        resolve(null);
        return;
      }
      resolve(session.getIdToken().getJwtToken());
    });
  });
}

export function getCurrentUser(): Promise<string | null> {
  return new Promise((resolve) => {
    const userPool = getUserPool();
    const currentUser = userPool.getCurrentUser();
    if (!currentUser) {
      resolve(null);
      return;
    }
    currentUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) {
        resolve(null);
        return;
      }
      resolve(currentUser.getUsername());
    });
  });
}
