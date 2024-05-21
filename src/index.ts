// cannister code goes here
import { v4 as uuidv4 } from 'uuid';
import { Server, StableBTreeMap, ic } from 'azle';
import express from 'express';


class Course {
   id: string;
   creatorName: string;
   creatorAddress: string; // Store the principal
   title: string;
   content: string;
   attachmentURL: string;
   category: string;
   keyword: string;
   contact: string;
   createdAt: Date;
   updatedAt: Date | null
}

class FilterPayload {
  creatorName?: string;
  category?: string;
  keyword?: string;
}

type Result<T, E> = { type: 'Ok'; value: T } | { type: 'Err'; error: E };

function Ok<T>(value: T): Result<T, never> {
  return { type: 'Ok', value };
}

function Err<E>(error: E): Result<never, E> {
  return { type: 'Err', error };
}

// Conver them into persistent memory
const courseStorage = StableBTreeMap<string, Course>(0);
let admin: string;
let moderators: string[];

export default Server(() => {
  const app = express();
  app.use(express.json());

  // Add course
  app.post("/courses", (req, res) => {
    const course: Course =  {
      id: uuidv4(), createdAt: getCurrentDate(),
      creatorAddress: ic.caller().toString(), ...req.body
    };
    courseStorage.insert(course.id, course);
    res.json(course);
  });

  // Get all courses
  app.get("/courses", (req, res) => {
    res.json(courseStorage.values());
  });

  // Get one course
  app.get("/courses/:id", (req, res) => {
    const courseId = req.params.id;
    const courseOpt = courseStorage.get(courseId);
    if ("None" in courseOpt) {
        res.status(404).send(`the course with id=${courseId} not found`);
    } else {
        res.json(courseOpt.Some);
    }
  });

  // Update course
  app.put("/courses/:id", (req, res) => {
    const id = req.params.id;
    const result = update_course(id);
    if (result.type === 'Ok') {
      const course = result.value;
      const updatedMessage = { ...course, ...req.body, updatedAt: getCurrentDate()};
      courseStorage.insert(course.id, updatedMessage);
      res.json(updatedMessage);
    } else {
      res.status(400).send(`couldn't update a course with id=${id}. course not found`);
    }
  });

  // Add admin
  app.put("/admin/:address", (req, res) => {
    const address = req.params.address;
    const result = setAdmin(address);
    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  // Add moderator
  app.put("/moderator/:address", (req, res) => {
    const address = req.params.address;
    const result = addModerator(address);
    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  // Delete course
  app.delete("/courses/:id", (req, res) => {
    const courseId = req.params.id;
    const result = delete_course(courseId);
    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  // Delete all my courses course
  app.delete("/courses/", (req, res) => {
    const result = delete_course(courseId);
    if (result.type === 'Ok') {
      res.json(result.value);
    } else {
      res.status(400).send(result.error);
    }
  });

  return app.listen();
});

function setAdmin(address: string): Result<string, string> {
  let caller: string = ic.caller().toString();
  if (admin) {
    if(caller == admin ) {
      admin = address;
      return Ok(address);
    }
    return Err("not authorized");
  }
  admin = address;
  return Ok(address);
}

function addModerator(address: string): Result<string, string> {
  let caller = ic.caller().toString();

  if(caller != admin ) {
    return Err("not authorized");
  }

  if (moderators.length == 5) {
    return Err("maximum number of moderators added");
  }

  if(address in moderators) {
    return Err("moderator already added");
  }

  moderators.push(address);
  return Ok(address);
}

function getCurrentDate() {
   const timestamp = new Number(ic.time());
   return new Date(timestamp.valueOf() / 1000_000);
}

function filterCourses_OR(payload: FilterPayload): Course[] | string {
  if (!payload.keyword && !payload.category && !payload.creatorName) {
      return "Filter payload is empty; at least one filter criterion must be provided";
  }

  // Create an empty array
  const courses: Course[] = [];

  // Returns array of tuple values of key and the value
  let items = courseStorage.items();

  // Using for of loop to iterate through the array
  // Destructuring the two entries in each tuple
  for(const [key, course] of items) {
    let matches = false;
    if (payload.keyword) {
      matches = course.keyword == payload.keyword;
    }
    if (payload.category) {
      matches = matches || course.category == payload.category;
    }
    if (payload.creatorName) {
      matches = matches || course.creatorName == payload.creatorName;
    }
    if (matches) {
      courses.push(course);
    }
  }

  if (courses.length === 0) {
    return "not found";
  }
    return courses;
}

function filterCourses_And(payload: FilterPayload): Course[] | string {
  // Add a separate function to check if payload is empty
  if (!payload.keyword && !payload.category && !payload.creatorName) {
    return "Filter payload is empty; at least one filter criterion must be provided";
  }
  
  const courses: Course[] = [];
  
  // Returns array of tuple values of key and the value
  let items = courseStorage.items();

  // Using for of loop to iterate through the array
  // Destructuring the two entries in each tuple
  for(const[key, course] of items) {
    let matches = true;
    if (payload.keyword) {
      matches = matches && course.keyword == payload.keyword;
    }
    if (payload.category) {
      matches = matches && course.category == payload.category;
    }
    if (payload.creatorName) {
      matches = matches && course.creatorName == payload.creatorName;
    }
    if (matches) {
      courses.push(course);
    }
  }

  if (courses.length === 0) {
    return "No courses";
  }

  return courses;
}

// Either the course creator or the admin or a moderator can delete a course
function delete_course(id: string): Result<Course,string> {
  let caller = ic.caller.toString();
  const courseOpt = courseStorage.get(id);
  if ("None" in courseOpt) {
    return Err(`Course with id=${id} not found`);
  } else {
      const course = courseOpt.Some;
      if (caller == admin || caller ==  course.creatorAddress) {
        courseStorage.remove(id);
        return Ok(course);
      } else {
        return Err(`you are not authorized to delete course with id=${id}`);
      }
  }
}

// Either the course creator or the admin or a moderator can delete a course
function delete_my_course(): Result<String[],string> {
  let caller = ic.caller.toString();
  let keysOfCaller: string[] = [];
  let items = courseStorage.items();

  for (const [key, course] of items) {
    if (course.creatorAddress == caller) {
      keysOfCaller.push(key)
    }
  }

  if (keysOfCaller.length > 0){
    for (let id of keysOfCaller) {
      courseStorage.remove(id);
    }
    return Ok(keysOfCaller);
  } else {
    return Err("no courses for the caller");
  }
}

// Either the course creator or the admin or a moderator can update a course
function update_course(id: string): Result<Course, string> {
  let caller = ic.caller().toString();
  const courseOpt = courseStorage.get(id);
  if ("None" in courseOpt) {
     return Err(`couldn't update a course with id=${id}. course not found`);
  } else {
     const course = courseOpt.Some;
    if (caller == admin || moderators.includes(caller) || caller == course.creatorAddress ) {
      return Ok(course)
    } else {
      return Err(`you are not authorized to update the course with id=${id}`)
    }
  }
}