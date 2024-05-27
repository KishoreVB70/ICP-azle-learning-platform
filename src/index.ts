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
   updatedAt: Date | null
}

// To obtain information for filtering the courses
type FilterPayload = {
  creatorName?: string;
  category?: string;
  keyword?: string;
};

// Custom type for error handling from functions
type Result<T, E> = { type: 'Ok'; value: T } | { type: 'Err'; error: E };

function Ok<T>(value: T): Result<T, never> {
  return { type: 'Ok', value };
}

function Err<E>(error: E): Result<never, E> {
  return { type: 'Err', error };
}

// Storing important variables in persistent memory using stableBTreeMap
const courseStorage = StableBTreeMap<string, Course>(0);
const moderatorsStorage =  StableBTreeMap<string, string>(1);
const bannedUsersStorage = StableBTreeMap<string, string>(2);
const AdminStorage = StableBTreeMap<string, string>(3);

export default Server(() => {
  const app = express();
  app.use(express.json());

  // Add a new course
  app.post("/courses", (req, res) => {
    // Validate that the request contains all the required fields
    const validationError = validateCourseInput(req.body);
    if (validationError) {
      return res.status(400).send(validationError);
    }

    // Check if the user is banned
    const caller = ic.caller().toString();
    if (isBanned(caller)) {
      res.status(400).send("Cannot add course. User is banned")
    }

    // Create new instance of course
    // This syntax will eliminate any additional fields provided in the request body
    const course: Course =  {
      id: uuidv4(), 
      creatorAddress: ic.caller().toString(),
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

    // Add the course into persistent memory
    courseStorage.insert(course.id, course);
    res.json(course);
  });

  // Retreive all courses
  app.get("/courses", (req, res) => {
    if(courseStorage.isEmpty()) {
      return res.status(500).send("No courses added");
    }
    res.json(courseStorage.values());
  });

  // Retreive specific courses based on two techniques -> AND or OR
  app.get('/courses/filter', (req, res) => {
    // Check for the filter type
    const filterType = req.query.filterType as string;
    if(!filterType) {
      res.status(400).send("Provide filter type AND OR");
      return;
    }

    // Filter condition can be any combination of the three
    const payload: FilterPayload = {
      keyword: req.query.keyword as string,
      category: req.query.category as string,
      creatorName: req.query.creatorName as string
    };

    // The request should contain atleast one condition
    if(!payload.keyword && !payload.category && !payload.creatorName) {
      res.status(400).send("Provide atleast 1 filter condition");
    }

    // Initializing empty result type
    let result: Result<Course[], string>;

    // Calling the appropriate function based on the filter type
    // Returns all the courses matching the filter condition
    if (filterType.toUpperCase() === 'AND') {
      result = filterCourses_And(payload);
    } else if (filterType.toUpperCase() === 'OR') {
      result = filterCourses_OR(payload);
    } else {
      res.status(400).send("filter type must be either AND or OR");
      return;
    }

    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  // Retrieve one course based on the provided id
  app.get("/courses/:id", (req, res) => {
    const courseId = req.params.id;
    const courseOpt = courseStorage.get(courseId);
    if ("None" in courseOpt) {
        res.status(404).send(`the course with id=${courseId} not found`);
    } else {
        res.json(courseOpt.Some);
    }
  });

  // Update course based on the id
  app.put("/courses/:id", (req, res) => {
    const id = req.params.id;

    const { 
      creatorName, title, content, 
      attachmentURL, category, keyword, contact 
    } = req.body;

    // Obtain the principal of the caller
    const caller = ic.caller().toString();

    // validate if the course exist and the caller is authorized to update
    const result = validateUpdate(id, caller);

    if (result.type === 'Ok') {
      const course = result.value;

      // Update the provided fields and retain the others
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
      res.status(400).send(`couldn't update a course with id=${id}. course not found`);
    }
  });

  // Delete course based on the id
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

  // Delete all the courses of the user
  app.delete("/courses/", (req, res) => {
    let caller: string = ic.caller().toString();
    // Removes all the courses that contains the caller as the creator
    const result = deleteAllCourses(caller);
    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  // Delete all the courses of the address 
  app.delete("/courses/address/:add", (req, res) => {
    const address = req.params.add;
    const caller = ic.caller().toString();

    // Only the admin or a moderator or the address themselves can delete
    const result = deleteCourses(address, caller);
    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  // Administrative functions

  // View the admin
  app.get("/admin", (req, res) => {
    if (!AdminStorage.isEmpty()) {
      const adminValue = AdminStorage.values(0,1);
      res.json(adminValue);
    } else {
      res.status(500).send("admin not set");
    }
  });

  // Retrieves all the moderator addresses
  app.get("/moderators", (req, res) => {
    if (!moderatorsStorage.isEmpty()) {
      return res.json(moderatorsStorage.values());
    }
    res.status(500).send("moderators not set");
  })

  // Set admin
  app.put("/admin/:address", (req, res) => {
    const address = req.params.address;
    let caller: string = ic.caller().toString();

    /* 
    Sets the admin to the input if not already initialized
    Allows the admin to change the admin address 
    */
    const result = setAdmin(address, caller);
    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  // Add a moderator
  app.put("/moderators/:address", (req, res) => {
    const address = req.params.address;
    let caller = ic.caller().toString();
    // Only the admin can add a moderator
    const result = addModerator(address, caller);
    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  // Remove a moderator
  app.delete("/moderators/:address", (req, res) => {
    const address: string = req.params.address;
    const caller = ic.caller().toString();
    // Only the admin can remove a moderator
    const result = removeModerator(address, caller);
    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  })

  // Ban user
  app.put("/ban/:address", (req, res) => {
    const address = req.params.address;
    const caller = ic.caller().toString();
    // Only the admin or a moderator can access
    const result = banUser(address, caller);
    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  // Unban user, removes the user id from the banned storage
  app.delete("/ban/:address", (req, res) => {
    const address = req.params.address;
    const caller = ic.caller().toString();
    // Only the admin or a moderator can access
    const result = unBanUser(address, caller);
    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  return app.listen();
});

/* 
Filters courses based on the provided criteria (OR condition).
The OR condition is such that it retreives the courses which satisfy any of the
criteria provided by the user 
*/
function filterCourses_OR(payload: FilterPayload): Result<Course[], string> {

  // Create an empty array
  const courses: Course[] = [];

  // Obtain array of all the courses
  let values = courseStorage.values();

  // Using for of loop to iterate through the array
  for(const course of values) {
    let matches = false;
    if (payload.keyword) {
      matches = course.keyword.toUpperCase() === payload.keyword.toUpperCase();
    }
    if (payload.category) {
      matches = matches || course.category.toUpperCase() === payload.category.toUpperCase();
    }
    if (payload.creatorName) {
      matches = matches || course.creatorName.toUpperCase() == payload.creatorName.toUpperCase();
    }
    if (matches) {
      courses.push(course);
    }
  }

  if (courses.length === 0) {
    return Err("no courses found");
  }
    return Ok(courses);
}

/*
Filters courses based on the provided criteria (AND condition)
The AND condition is such that it retreives the courses which satisfy all the
criteria provided by the user 
*/
function filterCourses_And(payload: FilterPayload): Result<Course[], string>{ 
  //Empty array for courses
  const courses: Course[] = [];
  
  // Returns array of courses
  let values = courseStorage.values();

  // Using for of loop to iterate through the array
  for(const course of values) {
    let matches = true;
    if (payload.keyword) {
      matches = matches && course.keyword.toUpperCase() === payload.keyword.toUpperCase();
    }
    if (payload.category) {
      matches = matches && course.category.toUpperCase() === payload.category.toUpperCase();
    }
    if (payload.creatorName) {
      matches = matches && course.creatorName.toUpperCase() === payload.creatorName.toUpperCase();
    }
    if (matches) {
      courses.push(course);
    }
  }

  if (courses.length === 0) {
    return Err("No courses found");
  }

  return Ok(courses);
}

// Validate the course input
function validateCourseInput(course: any): string | null {
  const requiredFields = [
    'creatorName', 'title', 'content', 'attachmentURL', 'category', 'keyword', 'contact'
  ];

  for (const field of requiredFields) {
    if (!course[field] || typeof course[field] !== 'string' || course[field].trim() === '') {
      return `${field} is required and must be a non-empty string.`;
    }
  }

  return null;
}

// Either the course creator or the admin or a moderator can update a course
function validateUpdate(id: string, caller: string): Result<Course, string> {
  const courseOpt = courseStorage.get(id);
  if ("None" in courseOpt) {
     return Err(`couldn't update a course with id=${id}. course not found`);
  }
  const course = courseOpt.Some;
  if (!isAuthorized(course, caller)) {
    return Err(`you are not authorized to update the course with id=${id}`)
  }
  return Ok(course)
}

// Either the course creator or the admin or a moderator can delete a course
function deleteCourse(id: string, caller: string): Result<Course,string> {
  const courseOpt = courseStorage.get(id);
  if ("None" in courseOpt) {
    return Err(`Course with id=${id} not found`);
  }
  const course = courseOpt.Some;
  if ( !isAuthorized(course, caller) ) {
    return Err(`you are not authorized to delete course with id=${id}`);
  } 
  courseStorage.remove(id);
  return Ok(course);
}

// Either the caller themselves or the admin or a moderator can delete the courses
function deleteCourses(address: string, caller: string): Result<string[], string> {
  if (isAdmin(caller) || isModerator(caller) || caller ===  address) {
    return deleteAllCourses(address);
  } else {
    return Err(`you are not authorized to delete courses for the address=${address}`);
  }
}

// Delete all the courses of the input address
function deleteAllCourses(address: string): Result<string[], string> {
    let keysOfAddress: string[] = [];

    // Returns an array of tuples containing the key and the value
    let items = courseStorage.items();
  
    // check if the address matches the creator
    for (const [key, course] of items) {
      if (course.creatorAddress.toUpperCase() === address.toUpperCase()) {
        keysOfAddress.push(key)
      }
    }

    // Remove all courses of the address
    if (keysOfAddress.length > 0){
      for (let id of keysOfAddress) {
        courseStorage.remove(id);
      }
      return Ok(keysOfAddress);
    } else {
      return Err("no courses found for the address");
    }
}

// Administrative functions
// If not already initialized, only admin can change
function setAdmin(address: string, caller: string): Result<string, string> {
  const items = AdminStorage.items();
  // Check if the admin is already set
  if (items.length > 0) {
    const [key, value] = items[0];

    // Chekcs if the caller is the admin
    if(caller === value) {
      // Changes the admin from the caller to the input
      AdminStorage.remove(key);
      AdminStorage.insert(uuidv4(),address);
      return Ok(address);
    }
    return Err("not authorized");
  }
  // If admin is not intialized, then the input is set as the admin
  AdminStorage.insert(uuidv4(),address);
  return Ok(address);
}

/*
Only admin can add a moderator
Maximum number of moderators is set to 5
A moderator can be set only once
*/
function addModerator(address: string, caller: string): Result<string, string> {
  // Checks if the caller is the admin
  if(!isAdmin(caller) ) {
    return Err("not authorized");
  }

  // Returns array of tuple containing key and values
  let moderators = moderatorsStorage.values();

  // Maximum number of moderators = 5
  if (moderators.length === 5) {
    return Err("maximum number of moderators added");
  }

  // Check if moderator already present
  for ( const value of moderators) {
    if (value === address) {
      return Err("moderator already added")
    }
  }

  // Add moderator into storage
  moderatorsStorage.insert(uuidv4(), address);
  return Ok(address);
}

// Only the admin can remove a moderator
function removeModerator(address: string, caller: string): Result<string, string> {
  if(!isAdmin(caller)) {
    return Err("You are not authorized to remove a moderator");
  }

  let moderators = moderatorsStorage.items();
  let isModerator: boolean = false;

  // Obtain the id of the address
  let id: string = "";
  for (const [key, value] of moderators) {
    if (value === address) {
      isModerator = true;
      id = key;
      break;
    }
  }

  if(!isModerator){
    return Err("Provided address is not a moderator");
  }

  // Remove the moderator
  moderatorsStorage.remove(id);
  return Ok(address);
}

/* 
Either the admin or a moderator can access
Cannot ban the admin or a moderator
*/
function banUser(address: string, caller: string): Result<string, string> {
  if (
    // Check whether the user is either the admin or a moderator
    ( !isAdmin(caller) && !isModerator(caller) ) ||

    // Check if the address to be banned is a moderator or admin
    ( isAdmin(address) || isModerator(address) )
  ) {
    return Err("you are not authorized to ban the user")
  }

  /*
  Delete all the courses of the banned user
  Due to this check, the same user cannot be banned twice 
  as a banned user cannot add course 
  */
  const result = deleteAllCourses(address)
  if(result.type ==='Ok') {
    bannedUsersStorage.insert(uuidv4(), address);
    return Ok(address);
  } else {
    return Err("User has no courses, cannot ban");
  }
}

// Either the admin or a moderator can access
function unBanUser(address: string, caller: string): Result<string, string> {
  if (
    !isAdmin(caller) || !isModerator(caller) 
  ) {
    return Err("you are not authorized to unban the user")
  }

  const bannedUsers = bannedUsersStorage.items();

  // Check if the user is banned  
  if(!isBanned(address)) {
    return Err("User is not banned");
  }

  let id: string = ""

  // Obtain the id of the banned user
  for (const [key, value] of bannedUsers) {
    if (value === address) {
      id = key;
    }
  }

  // Remove user from the list of banned users
  bannedUsersStorage.remove(id);
  return Ok(address);
}

// Checks if the caller is either the creator or the admin or a moderator
function isAuthorized(course: Course, caller: string): bool {
  if (isAdmin(caller) || isModerator(caller) || caller === course.creatorAddress ) {
    return true;
  } 
  return false;
}

// Validate the input to be the admin
function isAdmin(address: string): bool {
  const adminValues = AdminStorage.values();
  return address.toUpperCase() === adminValues[0].toUpperCase();
}

// Validate the input to be a moderator
function isModerator(address: string): bool {
  const moderators = moderatorsStorage.values();
  for (const value of moderators) {
    if (value.toUpperCase() === address.toUpperCase()) {
      return true
    }
  }
  return false
}

// Check whether the user is banned
function isBanned(address: string): bool {
  const bannedUsers = bannedUsersStorage.values();
  for (const value of bannedUsers) {
    if (value === address) {
      return true;
    }
  }
  return false;
}

function getCurrentDate() {
  const timestamp = new Number(ic.time());
  return new Date(timestamp.valueOf() / 1000_000);
}