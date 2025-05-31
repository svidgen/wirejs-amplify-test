import { AuthenticationService} from 'wirejs-resources';
import { Chat } from './apps/chat.js';
import { Todos } from './apps/todos.js';
import { Wiki } from './apps/wiki.js';

export type { Todo } from './apps/todos.js';

const authService = new AuthenticationService('app', 'core-users');

export const auth = authService.buildApi();
export const chat = Chat(auth);
export const todos = Todos(auth);
export const wiki = Wiki(auth);
