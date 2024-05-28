import { v4 as uuidv4 } from 'uuid';
import { Server, StableBTreeMap, bool, ic } from 'azle';
import express from 'express';

class Course {
   id: string;
   creatorAddress: string; // Store the principal of the creator
   creatorName: string;
   title: string;
   content: string;
   attachmentURL: string;
   category: string;
   keyword: string;
   contact: string;
   createdAt: Date;
   updatedAt: Date | null;
}

type FilterPayload = {
  creatorName?: string;
  category?: string;
  keyword?: string;
};

type Result<T, E> = { type: 'Ok'; value: T } | { type: 'Err'; error: E };

function Ok<T>(value: T): Result<T, never> {
  return { type: 'Ok', value };
}

function Err<E>(error: E): Result<never, E> {
  return { type: 'Err', error };
}

const courseStorage = StableBTreeMap<string, Course>(0);
const moderatorsStorage = StableBTreeMap<string, string>(1);
const bannedUsersStorage = StableBTreeMap<string, string>(2);
const AdminStorage = StableBTreeMap<string, string>(3);

const ERROR_MESSAGES = {
  notAuthorized: 'Not authorized',
  courseNotFound: 'Course not found',
  userBanned: 'Cannot add course. User is banned',
  noCoursesFound: 'No courses found',
  noCoursesAdded: 'No courses added',
  noUsersBanned: 'No users banned',
  userNotBanned: 'User is not banned',
  adminNotSet: 'Admin not set',
  moderatorsNotSet: 'Moderators not set',
  maxModerators: 'Maximum number of moderators added',
  moderatorExists: 'Moderator already added',
  moderatorNotFound: 'Provided address is not a moderator',
  filterTypeMissing: 'Provide filter type AND OR',
  filterConditionMissing: 'Provide at least 1 filter condition',
  inputInvalid: 'Input is invalid'
};

function isAdmin(address: string): bool {
  if (AdminStorage.isEmpty()) return false;
  const adminValues: string[] = AdminStorage.values(0, 1);
  return address === adminValues[0];
}

function isModerator(address: string): bool {
  if (moderatorsStorage.isEmpty()) return false;
  const moderators = moderatorsStorage.values();
  return moderators.includes(address);
}

function isBanned(address: string): bool {
  if (bannedUsersStorage.isEmpty()) return false;
  const bannedUsers = bannedUsersStorage.values();
  return bannedUsers.includes(address);
}

function isAuthorized(course: Course, caller: string): bool {
  return isAdmin(caller) || isModerator(caller) || caller === course.creatorAddress;
}

function validateCourseInput(course: any): string | null {
  const requiredFields = [
    'creatorName', 'title', 'content', 'attachmentURL', 'category', 'keyword', 'contact'
  ];

  for (const field of requiredFields) {
    if (!course[field] || typeof course[field] !== 'string' || course[field].trim() === '') {
      return `${field} is required and must be a non-empty string.`;
    }
  }

  // Additional validation
  if (!isValidURL(course.attachmentURL)) return 'Invalid URL for attachmentURL';
  if (!isValidEmail(course.contact)) return 'Invalid email for contact';
  return null;
}

function isValidURL(url: string): bool {
  const urlPattern = new RegExp('^(https?:\\/\\/)?' + // validate protocol
    '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.?)+[a-z]{2,}|' + // domain name
    '((\\d{1,3}\\.){3}\\d{1,3}))' + // OR ip (v4) address
    '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*' + // port and path
    '(\\?[;&a-z\\d%_.~+=-]*)?' + // query string
    '(\\#[-a-z\\d_]*)?$', 'i'); // fragment locator
  return !!urlPattern.test(url);
}

function isValidEmail(email: string): bool {
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailPattern.test(email);
}

function getCurrentDate() {
  const timestamp = new Number(ic.time());
  return new Date(timestamp.valueOf() / 1000_000);
}

function validateUpdate(id: string, caller: string): Result<Course, string> {
  const courseOpt = courseStorage.get(id);
  if ("None" in courseOpt) return Err(ERROR_MESSAGES.courseNotFound);
  const course = courseOpt.Some;
  if (!isAuthorized(course, caller)) return Err(ERROR_MESSAGES.notAuthorized);
  return Ok(course);
}

function deleteCourse(id: string, caller: string): Result<Course, string> {
  const courseOpt = courseStorage.get(id);
  if ("None" in courseOpt) return Err(ERROR_MESSAGES.courseNotFound);
  const course = courseOpt.Some;
  if (!isAuthorized(course, caller)) return Err(ERROR_MESSAGES.notAuthorized);
  courseStorage.remove(id);
  return Ok(course);
}

function deleteAllCourses(address: string): Result<string[], string> {
  const keysOfAddress: string[] = [];
  const items = courseStorage.items();

  for (const [key, course] of items) {
    if (course.creatorAddress.toUpperCase() === address.toUpperCase()) keysOfAddress.push(key);
  }

  if (keysOfAddress.length > 0) {
    keysOfAddress.forEach(id => courseStorage.remove(id));
    return Ok(keysOfAddress);
  } else {
    return Err(ERROR_MESSAGES.noCoursesFound);
  }
}

function filterCourses_OR(payload: FilterPayload): Result<Course[], string> {
  const courses: Course[] = [];
  const values = courseStorage.values();

  for (const course of values) {
    let matches = false;
    if (payload.keyword) matches = course.keyword.toUpperCase() === payload.keyword.toUpperCase();
    if (payload.category) matches = matches || course.category.toUpperCase() === payload.category.toUpperCase();
    if (payload.creatorName) matches = matches || course.creatorName.toUpperCase() === payload.creatorName.toUpperCase();
    if (matches) courses.push(course);
  }

  return courses.length === 0 ? Err(ERROR_MESSAGES.noCoursesFound) : Ok(courses);
}

function filterCourses_And(payload: FilterPayload): Result<Course[], string> {
  const courses: Course[] = [];
  const values = courseStorage.values();

  for (const course of values) {
    let matches = true;
    if (payload.keyword) matches = matches && course.keyword.toUpperCase() === payload.keyword.toUpperCase();
    if (payload.category) matches = matches && course.category.toUpperCase() === payload.category.toUpperCase();
    if (payload.creatorName) matches = matches && course.creatorName.toUpperCase() === payload.creatorName.toUpperCase();
    if (matches) courses.push(course);
  }

  return courses.length === 0 ? Err(ERROR_MESSAGES.noCoursesFound) : Ok(courses);
}

function setAdmin(address: string, caller: string): Result<string, string> {
  const items = AdminStorage.items();
  if (items.length > 0) {
    const [key, value] = items[0];
    if (caller === value) {
      AdminStorage.remove(key);
      AdminStorage.insert(uuidv4(), address);
      return Ok(address);
    }
    return Err(ERROR_MESSAGES.notAuthorized);
  }
  AdminStorage.insert(uuidv4(), address);
  return Ok(address);
}

function addModerator(address: string, caller: string): Result<string, string> {
  if (!isAdmin(caller)) return Err(ERROR_MESSAGES.notAuthorized);
  if (moderatorsStorage.isEmpty()) {
    moderatorsStorage.insert(uuidv4(), address);
    return Ok(address);
  }

  const moderators = moderatorsStorage.values();
  if (moderators.length === 5) return Err(ERROR_MESSAGES.maxModerators);
  if (moderators.includes(address)) return Err(ERROR_MESSAGES.moderatorExists);

  moderatorsStorage.insert(uuidv4(), address);
  return Ok(address);
}

function removeModerator(address: string, caller: string): Result<string, string> {
  if (!isAdmin(caller)) return Err(ERROR_MESSAGES.notAuthorized);
  if (moderatorsStorage.isEmpty()) return Err(ERROR_MESSAGES.moderatorsNotSet);

  const moderators = moderatorsStorage.items();
  let id = '';
  const isModerator = moderators.some(([key, value]) => {
    if (value === address) {
      id = key;
      return true;
    }
    return false;
  });

  if (!isModerator) return Err(ERROR_MESSAGES.moderatorNotFound);

  moderatorsStorage.remove(id);
  return Ok(address);
}

function banUser(address: string, caller: string): Result<string, string> {
  if ((!isAdmin(caller) && !isModerator(caller)) || isAdmin(address) || isModerator(address)) {
    return Err(ERROR_MESSAGES.notAuthorized);
  }

  const result = deleteAllCourses(address);
  if (result.type === 'Ok') {
    bannedUsersStorage.insert(uuidv4(), address);
    return Ok(address);
  } else {
    return Err('User has no courses, cannot ban');
  }
}

function unBanUser(address: string, caller: string): Result<string, string> {
  if (!isAdmin(caller) && !isModerator(caller)) return Err(ERROR_MESSAGES.notAuthorized);
  if (bannedUsersStorage.isEmpty()) return Err(ERROR_MESSAGES.noUsersBanned);
  if (!isBanned(address)) return Err(ERROR_MESSAGES.userNotBanned);

  const bannedUsers = bannedUsersStorage.items();
  let id = '';
  bannedUsers.forEach(([key, value]) => {
    if (value === address) id = key;
  });

  bannedUsersStorage.remove(id);
  return Ok(address);
}

function validateFilterPayload(payload: FilterPayload): string | null {
  if (!payload.keyword && !payload.category && !payload.creatorName) {
    return ERROR_MESSAGES.filterConditionMissing;
  }
  return null;
}

export default Server(() => {
  const app = express();
  app.use(express.json());

  app.post("/courses", (req, res) => {
    const validationError = validateCourseInput(req.body);
    if (validationError) return res.status(400).send(validationError);
    
    const caller = ic.caller().toString();
    if (isBanned(caller)) return res.status(400).send(ERROR_MESSAGES.userBanned);

    const course: Course = {
      id: uuidv4(),
      creatorAddress: caller,
      creatorName: req.body.creatorName,
      title: req.body.title,
      content: req.body.content,
      attachmentURL: req.body.attachmentURL,
      category: req.body.category,
      keyword: req.body.keyword,
      contact: req.body.contact,
      createdAt: getCurrentDate(),
      updatedAt: null
    };

    courseStorage.insert(course.id, course);
    res.json(course);
  });

  app.get("/courses", (req, res) => {
    if (courseStorage.isEmpty()) return res.status(500).send(ERROR_MESSAGES.noCoursesAdded);
    res.json(courseStorage.values());
  });

  app.get('/courses/filter', (req, res) => {
    const filterType = req.query.filterType as string;
    if (!filterType) return res.status(400).send(ERROR_MESSAGES.filterTypeMissing);

    const payload: FilterPayload = {
      keyword: req.query.keyword as string,
      category: req.query.category as string,
      creatorName: req.query.creatorName as string
    };

    const filterPayloadError = validateFilterPayload(payload);
    if (filterPayloadError) return res.status(400).send(filterPayloadError);

    let result: Result<Course[], string>;
    if (filterType.toUpperCase() === 'AND') {
      result = filterCourses_And(payload);
    } else if (filterType.toUpperCase() === 'OR') {
      result = filterCourses_OR(payload);
    } else {
      return res.status(400).send(ERROR_MESSAGES.filterTypeMissing);
    }

    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  app.get("/courses/:id", (req, res) => {
    const courseId = req.params.id;
    const courseOpt = courseStorage.get(courseId);
    if ("None" in courseOpt) return res.status(404).send(ERROR_MESSAGES.courseNotFound);
    res.json(courseOpt.Some);
  });

  app.put("/courses/:id", (req, res) => {
    const id = req.params.id;
    const {
      creatorName, title, content,
      attachmentURL, category, keyword, contact
    } = req.body;

    const caller = ic.caller().toString();
    const result = validateUpdate(id, caller);

    if (result.type === 'Ok') {
      const course = result.value;
      const updatedCourse: Course = {
        ...course,
        creatorName: creatorName || course.creatorName,
        title: title || course.title,
        content: content || course.content,
        attachmentURL: attachmentURL || course.attachmentURL,
        category: category || course.category,
        keyword: keyword || course.keyword,
        contact: contact || course.contact,
        updatedAt: getCurrentDate()
      };

      courseStorage.insert(course.id, updatedCourse);
      res.json(updatedCourse);
    } else {
      res.status(400).send(result.error);
    }
  });

  app.delete("/courses/:id", (req, res) => {
    const id = req.params.id;
    const caller = ic.caller().toString();
    const result = deleteCourse(id, caller);
    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  app.delete("/courses", (req, res) => {
    const caller = ic.caller().toString();
    const result = deleteAllCourses(caller);
    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  app.delete("/courses/address/:add", (req, res) => {
    const address = req.params.add;
    const caller = ic.caller().toString();
    const result = deleteCourses(address, caller);
    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  app.get("/admin", (req, res) => {
    if (!AdminStorage.isEmpty()) {
      const adminValue = AdminStorage.values(0, 1);
      res.json(adminValue);
    } else {
      res.status(500).send(ERROR_MESSAGES.adminNotSet);
    }
  });

  app.get("/moderators", (req, res) => {
    if (!moderatorsStorage.isEmpty()) {
      return res.json(moderatorsStorage.values());
    }
    res.status(500).send(ERROR_MESSAGES.moderatorsNotSet);
  });

  app.put("/admin/:address", (req, res) => {
    const address = req.params.address;
    const caller = ic.caller().toString();
    const result = setAdmin(address, caller);
    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  app.put("/moderators/:address", (req, res) => {
    const address = req.params.address;
    const caller = ic.caller().toString();
    const result = addModerator(address, caller);
    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  app.delete("/moderators/:address", (req, res) => {
    const address = req.params.address;
    const caller = ic.caller().toString();
    const result = removeModerator(address, caller);
    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  app.put("/ban/:address", (req, res) => {
    const address = req.params.address;
    const caller = ic.caller().toString();
    const result = banUser(address, caller);
    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  app.delete("/ban/:address", (req, res) => {
    const address = req.params.address;
    const caller = ic.caller().toString();
    const result = unBanUser(address, caller);
    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  return app.listen();
});
